# Agent 管理 API：列出已连接 agent、本地 agent 信息、远程会话、重命名
from __future__ import annotations

import socket
from typing import Any

from fastapi import APIRouter, HTTPException

from models.agent import KillProcessesRequest, UpdateAgentRequest
from services.agent_config import AgentConfigStore
from services.client_hub import ClientHub
from services.claude_broker import ClaudeBroker
from services.process_manager import scan_claude_processes
from services.session_store import parse_raw_jsonl_to_detail

router = APIRouter(tags=["Agent"])

# 模块级引用，在 main.py 中注入
_client_hub: ClientHub | None = None
_config_store: AgentConfigStore | None = None
_broker: ClaudeBroker | None = None


from config import APP_VERSION as _APP_VERSION


def init_agents_router(
    client_hub: ClientHub,
    agent_config: AgentConfigStore,
    broker: ClaudeBroker | None = None,
) -> None:
    """由 main.py 调用，注入依赖实例。"""
    global _client_hub, _config_store, _broker, _server_started_at
    _client_hub = client_hub
    _config_store = agent_config
    _broker = broker
    from datetime import datetime, timezone
    _server_started_at = datetime.now(timezone.utc).isoformat()


_server_started_at: str = ""


def _build_local_agent() -> dict[str, Any]:
    """构建本地 agent 的信息字典。"""

    processes = scan_claude_processes()

    # broker 托管会话数
    broker_session_count = 0
    if _broker:
        broker_session_count = len(_broker.list_sessions())

    local_display_name = socket.gethostname()
    if _config_store:
        saved = _config_store.get_display_name("local")
        if saved:
            local_display_name = saved

    return {
        "agent_id": "local",
        "hostname": socket.gethostname(),
        "display_name": local_display_name,
        "type": "local",
        "state": "online",
        "mode": "local",
        "allowed_paths": [],
        "agent_version": _APP_VERSION,
        "latency_ms": 0,
        "last_heartbeat": "",
        "connected_at": _server_started_at,
        "session_count": broker_session_count,
        "process_count": len(processes),
    }


@router.get(
    "/agents",
    summary="列出所有已连接 agent",
    description="返回所有已注册的 cm-agent 连接信息，包括本地 agent、daemon 和 oneshot 模式。",
)
async def list_agents() -> list[dict[str, Any]]:
    if _client_hub is None:
        raise HTTPException(status_code=503, detail="ClientHub 未初始化")
    local_agent = _build_local_agent()
    remote_agents = _client_hub.list_agents()
    return [local_agent, *remote_agents]


@router.get(
    "/agents/local/processes",
    summary="获取本地 Claude Code 进程列表",
    description="扫描本地 /proc 返回所有活跃的 Claude Code 进程。",
)
async def get_local_processes() -> list[dict[str, Any]]:
    processes = scan_claude_processes()
    return [p.model_dump() if hasattr(p, "model_dump") else p.dict() for p in processes]


@router.get(
    "/agents/{agent_id}/processes",
    summary="获取 agent 的远程进程列表",
    description="返回指定 agent 上报的 Claude Code 进程列表。支持 agent_id='local' 返回本地进程。",
)
async def get_agent_processes(agent_id: str) -> list[dict[str, Any]]:
    if agent_id == "local":
        processes = scan_claude_processes()
        return [p.model_dump() if hasattr(p, "model_dump") else p.dict() for p in processes]

    if _client_hub is None:
        raise HTTPException(status_code=503, detail="ClientHub 未初始化")
    agent = _client_hub.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail=f"agent {agent_id} 不存在")
    return _client_hub.get_agent_processes(agent_id)


@router.get(
    "/agents/{agent_id}/sessions",
    summary="获取 agent 的远程会话摘要列表",
    description="返回指定 agent 上报的 JSONL 会话摘要。本机 agent 不走此接口。",
)
async def get_agent_sessions(agent_id: str) -> list[dict[str, Any]]:
    if _client_hub is None:
        raise HTTPException(status_code=503, detail="ClientHub 未初始化")
    agent = _client_hub.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail=f"agent {agent_id} 不存在")
    return list(agent.remote_sessions.values())


@router.get(
    "/agents/{agent_id}/sessions/{session_id}",
    summary="获取远程会话的完整消息",
    description="通过 WebSocket 向 cm-agent 请求 JSONL 文件并解析为消息列表。",
)
async def get_agent_session_detail(agent_id: str, session_id: str, project: str = "") -> dict[str, Any]:
    if _client_hub is None:
        raise HTTPException(status_code=503, detail="ClientHub 未初始化")

    # 从 agent 的 remote_sessions 中找 project_path
    agent = _client_hub.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail=f"agent {agent_id} 不存在")

    remote_sess = agent.remote_sessions.get(session_id)
    project_path = remote_sess["project_path"] if remote_sess else project.replace("-", "/")
    if not project_path:
        raise HTTPException(status_code=400, detail="无法确定 project_path")

    result = await _client_hub.request_session_detail(agent_id, session_id, project_path)
    if not result:
        raise HTTPException(status_code=504, detail="请求超时或 agent 无响应")

    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])

    raw_jsonl = result.get("raw_jsonl", "")
    detail = parse_raw_jsonl_to_detail(raw_jsonl, session_id, project_path)
    if not detail:
        raise HTTPException(status_code=404, detail="会话内容为空")

    return detail.model_dump() if hasattr(detail, "model_dump") else {
        "summary": detail.summary.__dict__,
        "messages": [m.__dict__ for m in detail.messages],
    }


@router.post(
    "/agents/{agent_id}/kill-processes",
    summary="终止 agent 上的指定进程",
    description="向 agent 发送 kill 命令，终止指定 pid 列表中的 Claude 进程。不能终止 agent 自身和已托管的进程。",
)
async def kill_agent_processes(agent_id: str, body: KillProcessesRequest) -> dict[str, Any]:
    if _client_hub is None:
        raise HTTPException(status_code=503, detail="ClientHub 未初始化")
    pids = body.pids
    try:
        result = await _client_hub.kill_agent_processes(agent_id, pids)
        return {
            "killed": result.get("killed", []),
            "failed": result.get("failed", []),
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.patch(
    "/agents/{agent_id}",
    summary="更新 agent 配置",
    description="修改 agent 的显示名称等配置。",
)
async def update_agent(agent_id: str, body: UpdateAgentRequest) -> dict[str, Any]:
    display_name = body.display_name
    if display_name is not None:
        if _config_store:
            _config_store.set_display_name(agent_id, display_name)
        # Update in-memory agent if connected
        if agent_id != "local" and _client_hub:
            agent = _client_hub.get_agent(agent_id)
            if agent:
                agent.display_name = display_name
    return {"agent_id": agent_id, "display_name": display_name}
