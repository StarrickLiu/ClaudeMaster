# 消息及内容块数据模型
from __future__ import annotations

from pydantic import BaseModel, Field
from typing import Any


class ContentBlock(BaseModel):
    """对话消息中的单个内容块（文字、工具调用、工具结果、思维过程）。"""
    type: str
    text: str | None = None
    thinking: str | None = None
    id: str | None = None
    name: str | None = None
    input: dict[str, Any] | None = None
    tool_use_id: str | None = None
    content: Any | None = None
    is_error: bool | None = None


class TokenUsage(BaseModel):
    """API 调用的 token 用量统计。"""
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_input_tokens: int = 0
    cache_creation_input_tokens: int = 0


class Message(BaseModel):
    """经过解析和合并后的对话消息。"""
    uuid: str
    parent_uuid: str | None = Field(None, alias="parentUuid")
    type: str
    timestamp: str
    session_id: str = Field("", alias="sessionId")
    is_sidechain: bool = Field(False, alias="isSidechain")
    cwd: str | None = None
    git_branch: str | None = Field(None, alias="gitBranch")
    version: str | None = None
    agent_id: str | None = Field(None, alias="agentId")
    request_id: str | None = Field(None, alias="requestId")
    role: str | None = None
    content: str | list[ContentBlock] = ""
    model_name: str | None = None
    usage: TokenUsage | None = None

    model_config = {"populate_by_name": True}
