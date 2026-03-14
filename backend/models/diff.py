# Git 差异相关模型
from __future__ import annotations

from pydantic import BaseModel


class CommitInfo(BaseModel):
    """单条提交摘要。"""
    hash: str
    short_hash: str
    subject: str
    author: str
    date: str
    stat: str
    insertions: int
    deletions: int
    files_changed: int
