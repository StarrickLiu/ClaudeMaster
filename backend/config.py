# 全局配置：路径、端口、认证
from pathlib import Path
import os

CLAUDE_HOME: Path = Path.home() / ".claude"
PROJECTS_DIR: Path = CLAUDE_HOME / "projects"
HISTORY_FILE: Path = CLAUDE_HOME / "history.jsonl"
STATS_FILE: Path = CLAUDE_HOME / "stats-cache.json"

HOST: str = "0.0.0.0" if os.getenv("AUTH_TOKEN") else "127.0.0.1"
PORT: int = int(os.getenv("PORT", "8420"))
AUTH_TOKEN: str | None = os.getenv("AUTH_TOKEN")
