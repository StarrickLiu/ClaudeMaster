# 用量统计服务：从 JSONL 文件聚合 token 用量和费用
from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from config import PROJECTS_DIR

logger = logging.getLogger(__name__)

# 定价表（美元 / 百万 tokens），与 claude-monitor 一致
_PRICING: dict[str, dict[str, float]] = {
    "opus": {"input": 15.0, "output": 75.0, "cache_creation": 18.75, "cache_read": 1.5},
    "sonnet": {"input": 3.0, "output": 15.0, "cache_creation": 3.75, "cache_read": 0.3},
    "haiku": {"input": 0.25, "output": 1.25, "cache_creation": 0.3, "cache_read": 0.03},
}


def _get_pricing(model: str) -> dict[str, float]:
    """根据模型名匹配定价。"""
    m = model.lower()
    if "opus" in m:
        return _PRICING["opus"]
    if "haiku" in m:
        return _PRICING["haiku"]
    return _PRICING["sonnet"]  # 默认 Sonnet


def _calc_cost(
    model: str,
    input_t: int,
    output_t: int,
    cache_create: int = 0,
    cache_read: int = 0,
) -> float:
    """计算单条消息费用。"""
    p = _get_pricing(model)
    return (
        input_t / 1_000_000 * p["input"]
        + output_t / 1_000_000 * p["output"]
        + cache_create / 1_000_000 * p["cache_creation"]
        + cache_read / 1_000_000 * p["cache_read"]
    )


class UsageStats(BaseModel):
    """用量统计。"""
    input_tokens: int = 0
    output_tokens: int = 0
    cache_creation_tokens: int = 0
    cache_read_tokens: int = 0
    total_tokens: int = 0
    cost_usd: float = 0.0
    message_count: int = 0


class DailyUsage(BaseModel):
    """每日用量。"""
    date: str
    total_tokens: int = 0
    cost_usd: float = 0.0
    message_count: int = 0


class UsageResponse(BaseModel):
    """用量响应。"""
    today: UsageStats
    window_5h: UsageStats
    daily: list[DailyUsage]


# 缓存
_cache: dict[str, tuple[float, UsageResponse]] = {}
_CACHE_TTL = 60  # 秒


def _parse_timestamp(ts: str) -> datetime | None:
    """解析 ISO 8601 时间戳。"""
    try:
        ts_clean = ts.replace("Z", "+00:00")
        dt = datetime.fromisoformat(ts_clean)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except (ValueError, TypeError):
        logger.debug("时间戳解析失败: %s", ts)
        return None


def _scan_usage_entries(cutoff: datetime) -> list[dict[str, Any]]:
    """扫描所有 JSONL 文件，提取 cutoff 之后含 usage 的消息。"""
    entries: list[dict[str, Any]] = []
    if not PROJECTS_DIR.exists():
        return entries

    for jsonl_file in PROJECTS_DIR.rglob("*.jsonl"):
        try:
            with open(jsonl_file, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        obj = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    # 需要有 usage 数据
                    msg = obj.get("message", {})
                    if not isinstance(msg, dict):
                        continue
                    usage = msg.get("usage")
                    if not usage:
                        continue

                    ts_str = obj.get("timestamp", "")
                    ts = _parse_timestamp(ts_str)
                    if not ts or ts < cutoff:
                        continue

                    model = msg.get("model", "")
                    entries.append({
                        "timestamp": ts,
                        "model": model,
                        "input_tokens": usage.get("input_tokens", 0),
                        "output_tokens": usage.get("output_tokens", 0),
                        "cache_creation_tokens": usage.get("cache_creation_input_tokens", 0),
                        "cache_read_tokens": usage.get("cache_read_input_tokens", 0),
                    })
        except Exception:
            logger.debug("读取 %s 失败", jsonl_file, exc_info=True)

    return entries


def _aggregate(entries: list[dict[str, Any]]) -> UsageStats:
    """聚合 token 用量。"""
    stats = UsageStats()
    for e in entries:
        stats.input_tokens += e["input_tokens"]
        stats.output_tokens += e["output_tokens"]
        stats.cache_creation_tokens += e["cache_creation_tokens"]
        stats.cache_read_tokens += e["cache_read_tokens"]
        stats.cost_usd += _calc_cost(
            e["model"],
            e["input_tokens"],
            e["output_tokens"],
            e["cache_creation_tokens"],
            e["cache_read_tokens"],
        )
        stats.message_count += 1
    stats.total_tokens = (
        stats.input_tokens + stats.output_tokens
        + stats.cache_creation_tokens + stats.cache_read_tokens
    )
    stats.cost_usd = round(stats.cost_usd, 4)
    return stats


def _compute_usage() -> UsageResponse:
    """计算完整的用量响应。"""
    now = datetime.now(timezone.utc)

    # 7 天前作为最大回溯范围
    cutoff_7d = now - timedelta(days=7)
    all_entries = _scan_usage_entries(cutoff_7d)

    # 今日（UTC 00:00 至今）
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_entries = [e for e in all_entries if e["timestamp"] >= today_start]
    today_stats = _aggregate(today_entries)

    # 5 小时滑动窗口
    window_start = now - timedelta(hours=5)
    window_entries = [e for e in all_entries if e["timestamp"] >= window_start]
    window_stats = _aggregate(window_entries)

    # 每日汇总（最近 7 天，缺失日期补零，确保连续 7 天）
    daily_map: dict[str, list[dict[str, Any]]] = {}
    for e in all_entries:
        day_key = e["timestamp"].strftime("%Y-%m-%d")
        daily_map.setdefault(day_key, []).append(e)

    # 生成最近 7 天的连续日期列表
    daily: list[DailyUsage] = []
    for i in range(6, -1, -1):
        day_dt = now - timedelta(days=i)
        day_key = day_dt.strftime("%Y-%m-%d")
        entries_for_day = daily_map.get(day_key, [])
        if entries_for_day:
            day_stats = _aggregate(entries_for_day)
            daily.append(DailyUsage(
                date=day_key,
                total_tokens=day_stats.total_tokens,
                cost_usd=day_stats.cost_usd,
                message_count=day_stats.message_count,
            ))
        else:
            daily.append(DailyUsage(
                date=day_key,
                total_tokens=0,
                cost_usd=0.0,
                message_count=0,
            ))

    return UsageResponse(today=today_stats, window_5h=window_stats, daily=daily)


def _compute_daily_chart(days: int) -> list[DailyUsage]:
    """计算最近 N 天每日用量（用于图表时间跨度切换）。"""
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=days)
    all_entries = _scan_usage_entries(cutoff)

    daily_map: dict[str, list[dict[str, Any]]] = {}
    for e in all_entries:
        day_key = e["timestamp"].strftime("%Y-%m-%d")
        daily_map.setdefault(day_key, []).append(e)

    result: list[DailyUsage] = []
    for i in range(days - 1, -1, -1):
        day_dt = now - timedelta(days=i)
        day_key = day_dt.strftime("%Y-%m-%d")
        entries_for_day = daily_map.get(day_key, [])
        if entries_for_day:
            s = _aggregate(entries_for_day)
            result.append(DailyUsage(
                date=day_key,
                total_tokens=s.total_tokens,
                cost_usd=s.cost_usd,
                message_count=s.message_count,
            ))
        else:
            result.append(DailyUsage(date=day_key, total_tokens=0, cost_usd=0.0, message_count=0))
    return result


# 图表缓存（按天数分别缓存）
_chart_cache: dict[int, tuple[float, list[DailyUsage]]] = {}
_CHART_CACHE_TTL = 120  # 2 分钟


async def get_daily_chart(days: int) -> list[DailyUsage]:
    """获取指定天数的每日用量图表数据（带缓存）。"""
    cached = _chart_cache.get(days)
    if cached and time.time() - cached[0] < _CHART_CACHE_TTL:
        return cached[1]
    result = await asyncio.to_thread(_compute_daily_chart, days)
    _chart_cache[days] = (time.time(), result)
    return result


async def get_usage() -> UsageResponse:
    """获取用量数据（带 60 秒缓存）。"""
    cached = _cache.get("usage")
    if cached and time.time() - cached[0] < _CACHE_TTL:
        return cached[1]

    result = await asyncio.to_thread(_compute_usage)
    _cache["usage"] = (time.time(), result)
    return result
