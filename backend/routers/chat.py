# 交互式会话管理 API：启动、列表、停止（支持本地和远程会话）
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.claude_broker import broker
from services.session_registry import SessionRegistry

router = APIRouter(tags=["交互"])

# 模块级引用，在 main.py 中注入
_registry: SessionRegistry | None = None


def init_chat_router(registry: SessionRegistry) -> None:
    """由 main.py 调用，注入 SessionRegistry 实例。"""
    global _registry
    _registry = registry


class StartChatRequest(BaseModel):
    """启动会话请求。"""

    project_path: str
    resume_session_id: str | None = None
    allowed_tools: list[str] | None = None
    permission_mode: str | None = None
    max_budget_usd: float | None = None
    max_turns: int | None = None
    append_system_prompt: str | None = None
    model: str | None = None
    add_dirs: list[str] | None = None
    name: str | None = None
    agent_id: str | None = None  # 指定远程 agent 启动会话


class ChatSessionInfo(BaseModel):
    """会话信息。"""

    session_id: str
    project_path: str
    state: str
    name: str = ""
    launch_config: dict[str, Any] = {}
    claude_session_id: str | None = None  # 真实 Claude session_id（与 JSONL 一致）
    pending_tool: str | None = None   # 待审批工具名（仅 waiting_permission 状态）
    source: str | None = None  # "local" | "remote"，None 表示本地（向后兼容）
    hostname: str | None = None  # 远程会话的主机名
    client_id: str | None = None  # 远程会话的 client_id
    agent_id: str | None = None  # 远程会话所属 agent_id


@router.post(
    "/chat/start",
    summary="启动交互式会话",
    description="启动新的 Claude Code 子进程或恢复已有会话。返回 session_id 后，客户端通过 WebSocket /ws/chat/{session_id} 连接。",
    response_model=ChatSessionInfo,
)
async def start_chat(req: StartChatRequest) -> ChatSessionInfo:
    if _registry is None:
        raise RuntimeError("SessionRegistry 未初始化")

    # 远程启动：通过 agent_id 在远程机器上启动会话
    if req.agent_id:
        try:
            rs = await _registry.start_remote_session(
                agent_id=req.agent_id,
                project_path=req.project_path,
                claude_args=_build_claude_args(req),
                name=req.name,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        return ChatSessionInfo(
            session_id=rs.initial_id,
            project_path=rs.project_path,
            state=rs.state,
            name=rs.name,
            launch_config=rs.launch_config,
            source="remote",
            hostname=rs.hostname,
            client_id=rs.client_id,
            agent_id=rs.agent_id,
        )

    # 本地启动
    try:
        cs = await broker.start_session(
            req.project_path,
            req.resume_session_id,
            allowed_tools=req.allowed_tools,
            permission_mode=req.permission_mode,
            max_budget_usd=req.max_budget_usd,
            max_turns=req.max_turns,
            append_system_prompt=req.append_system_prompt,
            model=req.model,
            add_dirs=req.add_dirs,
            name=req.name,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    # 返回 initial_id 作为稳定标识符（不受 init 事件重映射影响）
    real_id = cs.session_id if cs.session_id != cs.initial_id else None
    return ChatSessionInfo(
        session_id=cs.initial_id or cs.session_id,
        project_path=cs.project_path,
        state=cs.state,
        name=cs.name,
        launch_config=cs.launch_config,
        claude_session_id=real_id,
        source="local",
    )


def _build_claude_args(req: StartChatRequest) -> list[str]:
    """将 StartChatRequest 中的配置转换为 Claude CLI 参数列表。"""
    args: list[str] = []
    if req.resume_session_id:
        args.extend(["--resume", req.resume_session_id])
    if req.model:
        args.extend(["--model", req.model])
    if req.permission_mode:
        args.extend(["--permission-mode", req.permission_mode])
    if req.max_budget_usd is not None:
        args.extend(["--max-budget-usd", str(req.max_budget_usd)])
    if req.max_turns is not None:
        args.extend(["--max-turns", str(req.max_turns)])
    if req.append_system_prompt:
        args.extend(["--append-system-prompt", req.append_system_prompt])
    if req.allowed_tools:
        for tool in req.allowed_tools:
            args.extend(["--allowedTools", tool])
    if req.add_dirs:
        for d in req.add_dirs:
            args.extend(["--add-dir", d])
    return args


@router.get(
    "/chat/sessions",
    summary="列出活跃交互会话",
    description="返回当前由 ClaudeMaster 管理的所有会话（包括本地子进程和远程 agent）。",
    response_model=list[ChatSessionInfo],
)
async def list_chat_sessions() -> list[ChatSessionInfo]:
    if _registry is None:
        raise RuntimeError("SessionRegistry 未初始化")
    return [ChatSessionInfo(**s) for s in _registry.list_all_sessions()]


class UpdateChatRequest(BaseModel):
    """更新会话属性请求。"""

    name: str | None = None


@router.patch(
    "/chat/{session_id}",
    summary="更新会话属性",
    description="修改指定交互会话的名称等属性。",
    response_model=ChatSessionInfo,
)
async def update_chat(session_id: str, req: UpdateChatRequest) -> ChatSessionInfo:
    if _registry is None:
        raise RuntimeError("SessionRegistry 未初始化")
    cs = _registry.get_session(session_id)
    if not cs:
        raise HTTPException(status_code=404, detail=f"会话 {session_id} 不存在")
    if req.name is not None:
        cs.name = req.name.strip()
    real_id = cs.session_id if cs.session_id != cs.initial_id else None

    from services.client_hub import RemoteSession
    is_remote = isinstance(cs, RemoteSession)

    return ChatSessionInfo(
        session_id=cs.initial_id or cs.session_id,
        project_path=cs.project_path,
        state=cs.state,
        name=cs.name,
        launch_config=cs.launch_config,
        claude_session_id=real_id,
        source="remote" if is_remote else "local",
        hostname=cs.hostname if is_remote else None,
        client_id=cs.client_id if is_remote else None,
        agent_id=cs.agent_id if is_remote else None,
    )


@router.post(
    "/chat/{session_id}/stop",
    summary="停止交互式会话",
    description="终止指定的 Claude Code 子进程。",
)
async def stop_chat(session_id: str) -> dict[str, bool]:
    if _registry is None:
        raise RuntimeError("SessionRegistry 未初始化")
    try:
        await _registry.stop_session(session_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"success": True}
