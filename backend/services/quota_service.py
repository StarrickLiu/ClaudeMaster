# Claude Code 用量配额服务：从 Anthropic OAuth API 获取真实剩余用量
from __future__ import annotations

import asyncio
import json
import logging
import time
import urllib.request
from pathlib import Path

from pydantic import BaseModel

logger = logging.getLogger(__name__)

_CREDENTIALS_FILE = Path.home() / ".claude" / ".credentials.json"
_QUOTA_URL = "https://api.anthropic.com/api/oauth/usage"
_BETA_HEADER = "oauth-2025-04-20"
# 使用与 claude code 1.x 一致的 User-Agent，避免 403
_USER_AGENT = "claude-code/1.0.43"

# 缓存 (30 秒，避免频繁请求)
_quota_cache: tuple[float, "QuotaResponse"] | None = None
_CACHE_TTL = 30


class QuotaWindow(BaseModel):
    """单个时间窗口的用量。"""
    utilization: float      # 已使用百分比 (0-100)
    resets_at: str | None   # ISO 8601 重置时间
    remaining: float        # 剩余百分比 (computed)


class QuotaResponse(BaseModel):
    """配额响应。"""
    five_hour: QuotaWindow | None = None
    seven_day: QuotaWindow | None = None
    seven_day_sonnet: QuotaWindow | None = None
    seven_day_opus: QuotaWindow | None = None
    subscription_type: str | None = None
    error: str | None = None


def _read_credentials() -> dict:
    """读取 ~/.claude/.credentials.json。"""
    try:
        if not _CREDENTIALS_FILE.exists():
            return {}
        return json.loads(_CREDENTIALS_FILE.read_text()).get("claudeAiOauth", {})
    except Exception as e:
        logger.debug("读取凭证失败: %s", e)
        return {}


def _do_request(token: str) -> dict:
    """执行 HTTP 请求，返回原始 JSON dict。失败抛出异常。"""
    req = urllib.request.Request(
        _QUOTA_URL,
        headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {token}",
            "anthropic-beta": _BETA_HEADER,
            "User-Agent": _USER_AGENT,
        },
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode())


def _fetch_quota_sync() -> QuotaResponse:
    """同步调用 Anthropic OAuth usage API（最多重试一次）。"""
    creds = _read_credentials()
    token = creds.get("accessToken")
    if not token:
        return QuotaResponse(error="未找到 Claude OAuth 凭证（~/.claude/.credentials.json）")

    last_err = ""
    for attempt in range(2):
        try:
            raw = _do_request(token)
            break
        except urllib.error.HTTPError as e:
            body = ""
            try:
                body = e.read().decode()
            except Exception:
                pass
            last_err = f"API 返回 {e.code}"
            logger.warning("Quota API %s (尝试 %d): %s", e.code, attempt + 1, body[:200])
            if e.code != 403 or attempt > 0:
                return QuotaResponse(error=last_err)
            time.sleep(0.5)
        except Exception as e:
            last_err = str(e)
            logger.warning("Quota API 调用失败: %s", e)
            return QuotaResponse(error=last_err)
    else:
        return QuotaResponse(error=last_err)

    def _make_window(key: str) -> QuotaWindow | None:
        w = raw.get(key)
        if not w or w.get("utilization") is None:
            return None
        util = float(w["utilization"])
        return QuotaWindow(
            utilization=round(util, 1),
            resets_at=w.get("resets_at"),
            remaining=round(max(0.0, 100.0 - util), 1),
        )

    return QuotaResponse(
        five_hour=_make_window("five_hour"),
        seven_day=_make_window("seven_day"),
        seven_day_sonnet=_make_window("seven_day_sonnet"),
        seven_day_opus=_make_window("seven_day_opus"),
        subscription_type=creds.get("subscriptionType"),
    )


async def get_quota() -> QuotaResponse:
    """获取配额数据（带 30 秒缓存）。"""
    global _quota_cache
    if _quota_cache and time.time() - _quota_cache[0] < _CACHE_TTL:
        return _quota_cache[1]

    result = await asyncio.to_thread(_fetch_quota_sync)
    _quota_cache = (time.time(), result)
    return result
