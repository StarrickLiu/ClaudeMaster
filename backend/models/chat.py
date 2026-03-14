# 交互式会话相关的请求/响应模型
from __future__ import annotations

from typing import Any

from pydantic import BaseModel


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
    agent_id: str | None = None


class ChatSessionInfo(BaseModel):
    """会话信息。"""

    session_id: str
    project_path: str
    state: str
    name: str = ""
    launch_config: dict[str, Any] = {}
    claude_session_id: str | None = None
    pending_tool: str | None = None
    source: str | None = None
    hostname: str | None = None
    client_id: str | None = None
    agent_id: str | None = None


class UpdateChatRequest(BaseModel):
    """更新会话属性请求。"""

    name: str | None = None
