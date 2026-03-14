# 会话基类：ClaudeSession 和 RemoteSession 的公共接口
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

logger = logging.getLogger(__name__)

EventCallback = Callable[[dict[str, Any]], Awaitable[None]]


@dataclass
class BaseSession:
    """ClaudeSession 和 RemoteSession 的公共基类。"""

    session_id: str = ""
    initial_id: str = ""
    name: str = ""
    state: str = "starting"
    launch_config: dict[str, Any] = field(default_factory=dict)
    pending_control_request: dict[str, Any] | None = field(default=None, repr=False)
    _subscribers: dict[str, EventCallback] = field(default_factory=dict, repr=False)

    def subscribe(self, callback: EventCallback) -> str:
        sub_id = uuid.uuid4().hex[:8]
        self._subscribers[sub_id] = callback
        return sub_id

    def unsubscribe(self, sub_id: str) -> None:
        self._subscribers.pop(sub_id, None)

    async def _notify(self, event: dict[str, Any]) -> None:
        for cb in list(self._subscribers.values()):
            try:
                await cb(event)
            except Exception:
                logger.debug("通知订阅者失败", exc_info=True)
