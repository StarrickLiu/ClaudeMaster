# 项目信息模型
from pydantic import BaseModel


class Project(BaseModel):
    """从 ~/.claude/projects/ 扫描到的项目。"""
    path: str
    name: str
    encoded_name: str
    session_count: int
    last_activity: str | None = None
