# 交互式会话管理 API：启动、列表、停止
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.claude_broker import broker

router = APIRouter(tags=["交互"])


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


class ChatSessionInfo(BaseModel):
    """会话信息。"""

    session_id: str
    project_path: str
    state: str
    name: str = ""
    launch_config: dict[str, Any] = {}
    claude_session_id: str | None = None  # 真实 Claude session_id（与 JSONL 一致）
    pending_tool: str | None = None   # 待审批工具名（仅 waiting_permission 状态）


@router.post(
    "/chat/start",
    summary="启动交互式会话",
    description="启动新的 Claude Code 子进程或恢复已有会话。返回 session_id 后，客户端通过 WebSocket /ws/chat/{session_id} 连接。",
    response_model=ChatSessionInfo,
)
async def start_chat(req: StartChatRequest) -> ChatSessionInfo:
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
    )


@router.get(
    "/chat/sessions",
    summary="列出活跃交互会话",
    description="返回当前由 ClaudeMaster 管理的所有 Claude Code 子进程。",
    response_model=list[ChatSessionInfo],
)
async def list_chat_sessions() -> list[ChatSessionInfo]:
    return [ChatSessionInfo(**s) for s in broker.list_sessions()]


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
    cs = broker.get_session(session_id)
    if not cs:
        raise HTTPException(status_code=404, detail=f"会话 {session_id} 不存在")
    if req.name is not None:
        cs.name = req.name.strip()
    real_id = cs.session_id if cs.session_id != cs.initial_id else None
    return ChatSessionInfo(
        session_id=cs.initial_id or cs.session_id,
        project_path=cs.project_path,
        state=cs.state,
        name=cs.name,
        launch_config=cs.launch_config,
        claude_session_id=real_id,
    )


@router.post(
    "/chat/{session_id}/stop",
    summary="停止交互式会话",
    description="终止指定的 Claude Code 子进程。",
)
async def stop_chat(session_id: str) -> dict[str, bool]:
    try:
        await broker.stop_session(session_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"success": True}
