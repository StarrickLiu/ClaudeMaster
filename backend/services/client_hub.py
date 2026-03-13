# 远程 cm-agent 会话管理：接收客户端连接，维护 RemoteSession
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from fastapi import WebSocket

from services.name_generator import generate_name

logger = logging.getLogger(__name__)

EventCallback = Callable[[dict[str, Any]], Awaitable[None]]

# 断线后保留会话的时间（秒）
DISCONNECT_TIMEOUT = 300  # 5 分钟


@dataclass
class RemoteSession:
    """远程 cm-agent 连接的会话，接口与 ClaudeSession 一致。"""

    session_id: str  # Claude 真实 session_id（从 init 事件获取）
    initial_id: str  # 稳定标识，用于 URL/WS/查找
    client_id: str
    project_path: str
    hostname: str
    name: str = ""
    state: str = "starting"  # starting | idle | streaming | waiting_permission | closed | disconnected
    launch_config: dict[str, Any] = field(default_factory=dict)
    pending_control_request: dict[str, Any] | None = field(default=None, repr=False)
    _subscribers: dict[str, EventCallback] = field(default_factory=dict, repr=False)
    _agent_ws: WebSocket | None = field(default=None, repr=False)
    _cleanup_task: asyncio.Task[None] | None = field(default=None, repr=False)

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


class ClientHub:
    """管理所有远程 cm-agent 连接的会话。"""

    def __init__(self) -> None:
        self._sessions: dict[str, RemoteSession] = {}  # 双 key：initial_id + session_id

    def get_session(self, session_id: str) -> RemoteSession | None:
        return self._sessions.get(session_id)

    def _unique_sessions(self) -> list[RemoteSession]:
        """去重返回所有独立会话。"""
        seen_ids: set[int] = set()
        result: list[RemoteSession] = []
        for rs in self._sessions.values():
            obj_id = id(rs)
            if obj_id not in seen_ids:
                seen_ids.add(obj_id)
                result.append(rs)
        return result

    def _active_names(self) -> set[str]:
        """返回所有活跃远程会话的名称集合。"""
        names: set[str] = set()
        for rs in self._unique_sessions():
            if rs.state not in ("closed",) and rs.name:
                names.add(rs.name)
        return names

    async def register_agent(
        self,
        client_id: str,
        ws: WebSocket,
        metadata: dict[str, Any],
    ) -> RemoteSession:
        """注册新的 agent 连接，返回 RemoteSession。"""
        hostname = metadata.get("hostname", "unknown")
        project_path = metadata.get("project_path", "")
        agent_session_id = metadata.get("session_id")  # agent 上报的 Claude session_id（可能为空）

        # 检查是否是断线重连（同 client_id）
        existing = self._sessions.get(client_id)
        if existing and existing.state == "disconnected":
            logger.info("agent 重连: client_id=%s, hostname=%s", client_id, hostname)
            if existing._cleanup_task:
                existing._cleanup_task.cancel()
                existing._cleanup_task = None
            existing._agent_ws = ws
            existing.state = "idle"
            existing.hostname = hostname
            if project_path:
                existing.project_path = project_path
            await existing._notify({"type": "_internal", "subtype": "reconnected"})
            return existing

        # 新会话
        initial_id = client_id  # 用 client_id 做稳定标识
        session_id = agent_session_id or initial_id

        existing_names = self._active_names()
        name = generate_name(existing_names)

        rs = RemoteSession(
            session_id=session_id,
            initial_id=initial_id,
            client_id=client_id,
            project_path=project_path,
            hostname=hostname,
            name=name,
            state="starting",
            _agent_ws=ws,
        )

        self._sessions[initial_id] = rs
        if session_id != initial_id:
            self._sessions[session_id] = rs

        logger.info(
            "agent 注册: client_id=%s, hostname=%s, project=%s, name=%s",
            client_id, hostname, project_path, name,
        )
        return rs

    async def unregister_agent(self, client_id: str) -> None:
        """agent 断开连接，标记 disconnected，启动超时清理。"""
        rs = self._sessions.get(client_id)
        if not rs:
            return

        rs._agent_ws = None

        if rs.state == "closed":
            # 已经关闭的会话直接清理
            self._cleanup_session(rs)
            return

        rs.state = "disconnected"
        await rs._notify({"type": "_internal", "subtype": "disconnected"})
        logger.info("agent 断开: client_id=%s, 将在 %ds 后清理", client_id, DISCONNECT_TIMEOUT)

        # 启动超时清理任务
        rs._cleanup_task = asyncio.create_task(self._delayed_cleanup(rs))

    async def _delayed_cleanup(self, rs: RemoteSession) -> None:
        """超时后清理断线会话。"""
        try:
            await asyncio.sleep(DISCONNECT_TIMEOUT)
            if rs.state == "disconnected":
                logger.info("agent 超时清理: client_id=%s", rs.client_id)
                rs.state = "closed"
                await rs._notify({"type": "_internal", "subtype": "closed"})
                self._cleanup_session(rs)
        except asyncio.CancelledError:
            pass

    def _cleanup_session(self, rs: RemoteSession) -> None:
        """从索引中移除会话的所有 key。"""
        self._sessions.pop(rs.initial_id, None)
        self._sessions.pop(rs.session_id, None)
        self._sessions.pop(rs.client_id, None)

    async def handle_agent_event(self, rs: RemoteSession, event: dict[str, Any]) -> None:
        """处理 agent 上报的事件，更新状态并通知 subscribers。"""
        evt_type = event.get("type")

        if evt_type != "stream_event":
            logger.info(
                "[REMOTE EVT] client=%s type=%s subtype=%s",
                rs.client_id[:8], evt_type, event.get("subtype"),
            )

        # 从 init 事件更新 session_id
        if event.get("type") == "system" and event.get("subtype") == "init":
            real_id = event.get("session_id", rs.session_id)
            if real_id != rs.session_id:
                logger.info(
                    "remote session_id 更新: %s → %s",
                    rs.session_id[:8], real_id[:8],
                )
                # 移除旧的 session_id key（如果不同于 initial_id）
                if rs.session_id != rs.initial_id:
                    self._sessions.pop(rs.session_id, None)
                rs.session_id = real_id
                self._sessions[real_id] = rs
            rs.state = "idle"

        # 状态更新逻辑（与 ClaudeBroker 对齐）
        if evt_type == "stream_event":
            if rs.state == "waiting_permission" and rs.pending_control_request:
                logger.info("[REMOTE PERM] Claude 已自动批准，清除 pending")
                rs.pending_control_request = None
            rs.state = "streaming"
        elif evt_type == "control_request":
            rs.state = "waiting_permission"
            rs.pending_control_request = event
        elif evt_type == "result":
            rs.state = "idle"
            rs.pending_control_request = None

        await rs._notify(event)

    async def handle_agent_status(self, rs: RemoteSession, status: dict[str, Any]) -> None:
        """处理 agent 状态报告（如 Claude 进程退出）。"""
        status_type = status.get("status")
        if status_type == "claude_exited":
            exit_code = status.get("exit_code", -1)
            logger.info("agent 报告 Claude 退出: client=%s, exit_code=%d", rs.client_id[:8], exit_code)
            rs.state = "closed"
            await rs._notify({"type": "_internal", "subtype": "closed"})
            self._cleanup_session(rs)

    async def send_to_agent(self, rs: RemoteSession, message: dict[str, Any]) -> None:
        """发送消息到 agent WebSocket。"""
        if not rs._agent_ws:
            raise ValueError(f"agent 未连接: {rs.client_id}")
        try:
            await rs._agent_ws.send_json(message)
        except Exception as e:
            logger.error("发送到 agent 失败: %s", e)
            raise ValueError(f"发送到 agent 失败: {e}")

    def list_sessions(self) -> list[dict[str, Any]]:
        """返回所有远程会话信息，格式与 ClaudeBroker.list_sessions() 兼容。"""
        result = []
        for rs in self._unique_sessions():
            item: dict[str, Any] = {
                "session_id": rs.initial_id,
                "project_path": rs.project_path,
                "state": rs.state,
                "name": rs.name,
                "launch_config": rs.launch_config,
                "claude_session_id": rs.session_id if rs.session_id != rs.initial_id else None,
                "pending_tool": None,
                "source": "remote",
                "hostname": rs.hostname,
                "client_id": rs.client_id,
            }
            if rs.pending_control_request:
                req = rs.pending_control_request.get("request", {})
                item["pending_tool"] = req.get("tool_name") or req.get("toolName")
            result.append(item)
        return result
