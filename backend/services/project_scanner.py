# 扫描 ~/.claude/projects/ 发现所有项目
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from config import PROJECTS_DIR
from models.project import Project


def decode_project_path(encoded: str) -> str:
    """将编码的项目目录名还原为原始路径。

    编码规则：'/' 替换为 '-'，例如
    '-home-star-codes-MyProject' → '/home/star/codes/MyProject'
    """
    path = encoded.replace("-", "/")
    return path


def _find_best_decode(encoded: str) -> str:
    """尝试解码路径，优先选择实际存在的路径。"""
    simple = decode_project_path(encoded)
    if Path(simple).exists():
        return simple
    # 如果简单解码不存在，尝试保留部分短横线
    # 从右向左逐段尝试拼接
    parts = encoded.lstrip("-").split("-")
    for i in range(len(parts), 0, -1):
        candidate = "/" + "/".join(parts[:i]) + "-" + "-".join(parts[i:]) if i < len(parts) else "/" + "/".join(parts)
        if Path(candidate).exists():
            return candidate
    return simple


def scan_projects() -> list[Project]:
    """扫描所有项目目录，返回项目列表。"""
    if not PROJECTS_DIR.exists():
        return []

    projects: list[Project] = []
    for entry in sorted(PROJECTS_DIR.iterdir()):
        if not entry.is_dir():
            continue
        encoded_name = entry.name
        project_path = _find_best_decode(encoded_name)
        project_name = Path(project_path).name

        # 统计 JSONL 文件
        jsonl_files = list(entry.glob("*.jsonl"))
        if not jsonl_files:
            continue

        last_mtime = max(f.stat().st_mtime for f in jsonl_files)
        last_activity = datetime.fromtimestamp(last_mtime, tz=timezone.utc).isoformat()

        projects.append(Project(
            path=project_path,
            name=project_name,
            encoded_name=encoded_name,
            session_count=len(jsonl_files),
            last_activity=last_activity,
        ))

    projects.sort(key=lambda p: p.last_activity or "", reverse=True)
    return projects
