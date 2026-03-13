# 会话名称持久化存储（JSON 文件）
from __future__ import annotations

import json
import random
from pathlib import Path

_STORE_PATH = Path.home() / ".claude" / "cm_session_names.json"

# 模块级缓存，懒加载
_names: dict[str, str] | None = None

# Docker-style English name generation
_ADJECTIVES = [
    "swift", "calm", "bold", "keen", "warm",
    "bright", "sharp", "cool", "wild", "quick",
    "steady", "vivid", "noble", "lucid", "crisp",
    "fierce", "gentle", "agile", "silent", "grand",
]

_NOUNS = [
    "fox", "oak", "star", "wolf", "hawk",
    "pine", "reef", "moon", "lynx", "tide",
    "peak", "dawn", "fern", "crow", "flame",
    "dune", "lake", "sage", "wren", "storm",
]


def _load() -> dict[str, str]:
    """从磁盘加载名称映射。"""
    global _names
    if _names is not None:
        return _names
    if _STORE_PATH.exists():
        try:
            _names = json.loads(_STORE_PATH.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            _names = {}
    else:
        _names = {}
    return _names


def _save() -> None:
    """持久化到磁盘。"""
    names = _load()
    _STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    _STORE_PATH.write_text(json.dumps(names, ensure_ascii=False, indent=2), encoding="utf-8")


def _generate_name(existing: set[str]) -> str:
    """生成一个不与已有名称重复的随机名称。"""
    for _ in range(50):
        name = f"{random.choice(_ADJECTIVES)}-{random.choice(_NOUNS)}"
        if name not in existing:
            return name
    # 兜底：加数字后缀
    base = f"{random.choice(_ADJECTIVES)}-{random.choice(_NOUNS)}"
    return f"{base}-{random.randint(10, 99)}"


def get_name(session_id: str) -> str | None:
    """获取会话名称，不存在返回 None。"""
    return _load().get(session_id)


def set_name(session_id: str, name: str) -> None:
    """设置会话名称并持久化。"""
    names = _load()
    names[session_id] = name
    _save()


def ensure_name(session_id: str) -> str:
    """确保会话有名称：有则返回，无则自动生成并持久化。"""
    names = _load()
    existing = names.get(session_id)
    if existing:
        return existing
    new_name = _generate_name(set(names.values()))
    names[session_id] = new_name
    _save()
    return new_name
