# 会话摘要和详情模型
from __future__ import annotations

from pydantic import BaseModel

from models.message import Message


class SessionSummary(BaseModel):
    """会话摘要信息，用于列表展示。"""
    session_id: str          # JSONL 文件名（内部索引键）
    resume_session_id: str | None = None  # JSONL 内部 sessionId（用于 claude --resume）
    project_path: str
    project_name: str
    first_message: str | None = None
    last_assistant_text: str | None = None
    user_turns: int = 0
    tool_use_count: int = 0
    message_count: int = 0
    start_time: str | None = None
    end_time: str | None = None
    git_branch: str | None = None
    is_active: bool = False
    total_input_tokens: int = 0
    total_output_tokens: int = 0


class SessionDetail(BaseModel):
    """会话详情，包含完整消息列表。"""
    summary: SessionSummary
    messages: list[Message]


class SubagentInfo(BaseModel):
    """子代理摘要信息。"""
    agent_id: str
    message_count: int
    first_message: str | None = None
