# Claude Code 进程信息模型
from pydantic import BaseModel


class ClaudeProcess(BaseModel):
    """运行中的 Claude Code 进程。"""
    pid: int
    cwd: str
    uptime_seconds: float
    project_name: str | None = None
    session_id: str | None = None
    git_branch: str | None = None
