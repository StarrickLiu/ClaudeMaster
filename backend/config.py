# 全局配置：路径、端口、认证
from pathlib import Path
import os
import shutil


def _find_claude_bin() -> str:
    """查找 claude 二进制：优先环境变量，其次 shutil.which，最后扫描 nvm 目录。"""
    if explicit := os.getenv("CLAUDE_BIN"):
        return explicit
    if found := shutil.which("claude"):
        return found
    # 补充扫描 nvm 常见位置
    nvm_root = Path.home() / ".nvm" / "versions" / "node"
    if nvm_root.is_dir():
        for node_dir in sorted(nvm_root.iterdir(), reverse=True):
            candidate = node_dir / "bin" / "claude"
            if candidate.exists():
                return str(candidate)
    return "claude"  # 兜底，让子进程报错时有明确提示


CLAUDE_HOME: Path = Path.home() / ".claude"
PROJECTS_DIR: Path = CLAUDE_HOME / "projects"
HISTORY_FILE: Path = CLAUDE_HOME / "history.jsonl"
STATS_FILE: Path = CLAUDE_HOME / "stats-cache.json"

AUTH_TOKEN: str | None = os.getenv("AUTH_TOKEN")
HOST: str = "0.0.0.0" if AUTH_TOKEN else "127.0.0.1"
PORT: int = int(os.getenv("PORT", "8420"))
CLAUDE_BIN: str = _find_claude_bin()
APP_VERSION: str = "0.3.0"
