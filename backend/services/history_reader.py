# 解析全局 history.jsonl
from __future__ import annotations

import asyncio
import json
from pathlib import Path

from config import HISTORY_FILE


def _read_history_sync(
    limit: int, offset: int, search: str | None,
) -> tuple[list[dict], int]:
    """同步读取历史文件。"""
    if not HISTORY_FILE.exists():
        return [], 0

    entries: list[dict] = []
    with open(HISTORY_FILE, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue

            display = obj.get("display", "")
            if search and search.lower() not in display.lower():
                continue

            entries.append({
                "display": display,
                "timestamp": obj.get("timestamp", 0),
                "project": obj.get("project", ""),
                "session_id": obj.get("sessionId", ""),
            })

    # 按时间倒序
    entries.sort(key=lambda x: x["timestamp"], reverse=True)
    total = len(entries)
    return entries[offset:offset + limit], total


async def read_history(
    limit: int = 100,
    offset: int = 0,
    search: str | None = None,
) -> tuple[list[dict], int]:
    """异步读取全局历史。"""
    return await asyncio.to_thread(_read_history_sync, limit, offset, search)
