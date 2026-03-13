# Agent 管理 API：列出已连接 agent 和远程进程
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from services.client_hub import ClientHub

router = APIRouter(tags=["Agent"])

# 模块级引用，在 main.py 中注入
_client_hub: ClientHub | None = None


def init_agents_router(client_hub: ClientHub) -> None:
    """由 main.py 调用，注入 ClientHub 实例。"""
    global _client_hub
    _client_hub = client_hub


@router.get(
    "/agents",
    summary="列出所有已连接 agent",
    description="返回所有已注册的 cm-agent 连接信息，包括 daemon 和 oneshot 模式。",
)
async def list_agents() -> list[dict[str, Any]]:
    if _client_hub is None:
        raise RuntimeError("ClientHub 未初始化")
    return _client_hub.list_agents()


@router.get(
    "/agents/{agent_id}/processes",
    summary="获取 agent 的远程进程列表",
    description="返回指定 agent 上报的 Claude Code 进程列表。",
)
async def get_agent_processes(agent_id: str) -> list[dict[str, Any]]:
    if _client_hub is None:
        raise RuntimeError("ClientHub 未初始化")
    agent = _client_hub.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail=f"agent {agent_id} 不存在")
    return _client_hub.get_agent_processes(agent_id)
