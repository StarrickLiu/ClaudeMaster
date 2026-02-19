# Docker 风格随机名称生成器：形容词-名词组合
from __future__ import annotations

import random

ADJECTIVES = [
    "swift", "bold", "calm", "keen", "warm",
    "cool", "bright", "vivid", "gentle", "sharp",
    "quick", "steady", "silent", "noble", "brave",
    "agile", "lively", "merry", "witty", "grand",
    "azure", "golden", "silver", "coral", "amber",
    "misty", "sunny", "lunar", "polar", "lucid",
]

NOUNS = [
    "fox", "owl", "elk", "lynx", "hawk",
    "wolf", "bear", "deer", "swan", "dove",
    "heron", "eagle", "otter", "panda", "raven",
    "tiger", "whale", "crane", "finch", "robin",
    "cedar", "maple", "aspen", "birch", "lotus",
    "river", "cliff", "cloud", "storm", "flame",
]


def generate_name(existing_names: set[str] | None = None) -> str:
    """生成 Docker 风格的随机名称（如 swift-fox）。

    如果与 existing_names 碰撞，追加数字后缀（swift-fox-2）。
    """
    existing = existing_names or set()
    adj = random.choice(ADJECTIVES)
    noun = random.choice(NOUNS)
    base = f"{adj}-{noun}"

    if base not in existing:
        return base

    # 碰撞：追加数字后缀
    for i in range(2, 1000):
        candidate = f"{base}-{i}"
        if candidate not in existing:
            return candidate

    # 极端情况：随机后缀
    return f"{base}-{random.randint(1000, 9999)}"
