# Agent 管理相关的请求模型
from __future__ import annotations

from pydantic import BaseModel


class KillProcessesRequest(BaseModel):
    """终止进程请求。"""
    pids: list[int]


class UpdateAgentRequest(BaseModel):
    """更新 agent 配置请求。"""
    display_name: str | None = None
