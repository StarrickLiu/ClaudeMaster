# Claude Code 用量配额服务：从 Anthropic OAuth API 获取真实剩余用量
from __future__ import annotations

import asyncio
import json
import logging
import time
import urllib.error
import urllib.request
from pathlib import Path

from pydantic import BaseModel

logger = logging.getLogger(__name__)

_CREDENTIALS_FILE = Path.home() / ".claude" / ".credentials.json"
_QUOTA_URL = "https://api.anthropic.com/api/oauth/usage"
_BETA_HEADER = "oauth-2025-04-20"
# 使用与 claude code 1.x 一致的 User-Agent，避免 403
_USER_AGENT = "claude-code/1.0.43"

# OAuth token 刷新配置（与 Claude Code CLI 一致）
_TOKEN_URL = "https://platform.claude.com/v1/oauth/token"
_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"

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


def _refresh_token(refresh_token: str) -> str | None:
    """使用 refresh_token 获取新的 access_token，成功后更新凭证文件。"""
    try:
        payload = json.dumps({
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": _CLIENT_ID,
        }).encode()
        req = urllib.request.Request(
            _TOKEN_URL,
            data=payload,
            headers={
                "Content-Type": "application/json",
                "User-Agent": _USER_AGENT,
                "anthropic-beta": _BETA_HEADER,
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())

        new_access = data.get("access_token", "")
        new_refresh = data.get("refresh_token", refresh_token)
        new_expires = data.get("expires_in", 3600)

        if not new_access:
            logger.warning("Token 刷新返回无 access_token: %s", data)
            return None

        # 更新凭证文件
        try:
            raw = json.loads(_CREDENTIALS_FILE.read_text()) if _CREDENTIALS_FILE.exists() else {}
            oauth = raw.get("claudeAiOauth", {})
            oauth["accessToken"] = new_access
            oauth["refreshToken"] = new_refresh
            oauth["expiresAt"] = int(time.time() * 1000) + new_expires * 1000
            raw["claudeAiOauth"] = oauth
            _CREDENTIALS_FILE.write_text(json.dumps(raw, indent=2, ensure_ascii=False))
            logger.info("OAuth token 已自动刷新，新 token 有效期 %ds", new_expires)
        except Exception as e:
            logger.warning("保存刷新后的凭证失败: %s", e)

        return new_access
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode()[:300]
        except Exception:
            logger.debug("读取 token 刷新错误响应体失败", exc_info=True)
        logger.warning("Token 刷新失败 HTTP %d: %s", e.code, body)
        return None
    except Exception as e:
        logger.warning("Token 刷新异常: %s", e)
        return None


def _is_token_expired(creds: dict) -> bool:
    """检查 token 是否即将过期（提前 5 分钟）。"""
    expires_at = creds.get("expiresAt", 0)
    if not expires_at:
        return False
    return time.time() * 1000 >= expires_at - 5 * 60 * 1000


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
    """同步调用 Anthropic OAuth usage API，token 过期时自动刷新。"""
    creds = _read_credentials()
    token = creds.get("accessToken")
    refresh = creds.get("refreshToken")
    if not token:
        return QuotaResponse(error="未找到 Claude OAuth 凭证（~/.claude/.credentials.json）")

    # 主动检测 token 即将过期，提前刷新
    if refresh and _is_token_expired(creds):
        logger.info("OAuth token 即将过期，主动刷新")
        new_token = _refresh_token(refresh)
        if new_token:
            token = new_token

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
                logger.debug("读取 Quota API 错误响应体失败", exc_info=True)
            last_err = f"API 返回 {e.code}"
            logger.warning("Quota API %s (尝试 %d): %s", e.code, attempt + 1, body[:200])

            # 401 = token 过期，尝试刷新后重试
            if e.code == 401 and attempt == 0 and refresh:
                logger.info("Quota API 401，尝试刷新 token")
                new_token = _refresh_token(refresh)
                if new_token:
                    token = new_token
                    continue
                return QuotaResponse(error="配额查询 401，token 刷新失败")

            if e.code == 403 and attempt == 0:
                time.sleep(0.5)
                continue

            return QuotaResponse(error=last_err)
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
