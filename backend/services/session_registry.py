# 统一会话索引：合并 ClaudeBroker 和 ClientHub 的会话查找与操作
from __future__ import annotations

import logging
from typing import Any

from services.base_session import BaseSession
from services.claude_broker import ClaudeBroker, ClaudeSession
from services.client_hub import ClientHub, RemoteSession

logger = logging.getLogger(__name__)

# 统一类型别名
SessionLike = ClaudeSession | RemoteSession


class SessionRegistry:
    """统一的会话索引，将 broker（本地）和 hub（远程）会话合并。"""

    def __init__(self, broker: ClaudeBroker, client_hub: ClientHub) -> None:
        self._broker = broker
        self._hub = client_hub

    def get_session(self, session_id: str) -> SessionLike | None:
        """按 ID 查找会话，优先 broker，再查 hub。"""
        cs = self._broker.get_session(session_id)
        if cs:
            return cs
        return self._hub.get_session(session_id)

    def list_all_sessions(self) -> list[dict[str, Any]]:
        """合并所有会话列表，broker 会话加 source='local'。"""
        result = []
        for item in self._broker.list_sessions():
            item["source"] = "local"
            item["hostname"] = None
            item["client_id"] = None
            item["agent_id"] = None
            result.append(item)
        result.extend(self._hub.list_sessions())
        return result

    async def send_message(self, session_id: str, text: str) -> None:
        """发送用户消息，自动路由到 broker 或 hub。"""
        session = self.get_session(session_id)
        if session is None:
            raise ValueError(f"会话 {session_id} 不存在")

        if isinstance(session, ClaudeSession):
            await self._broker.send_message(session_id, text)
        elif isinstance(session, RemoteSession):
            await self._hub.send_to_agent(session, {
                "type": "user_message",
                "text": text,
                "source": "web",
            })
        else:
            raise ValueError(f"未知会话类型: {type(session)}")

    async def send_control_response(
        self,
        session_id: str,
        request_id: str,
        behavior: str = "allow",
        message: str | None = None,
        updated_input: dict[str, Any] | None = None,
    ) -> None:
        """回复工具权限请求，自动路由。"""
        session = self.get_session(session_id)
        if session is None:
            raise ValueError(f"会话 {session_id} 不存在")

        if isinstance(session, ClaudeSession):
            await self._broker.send_control_response(
                session_id, request_id, behavior, message, updated_input,
            )
        elif isinstance(session, RemoteSession):
            msg: dict[str, Any] = {
                "type": "control_response",
                "request_id": request_id,
                "behavior": behavior,
            }
            if message:
                msg["message"] = message
            if updated_input:
                msg["updatedInput"] = updated_input
            await self._hub.send_to_agent(session, msg)
            # 清除 pending
            if session.pending_control_request and session.pending_control_request.get("request_id") == request_id:
                session.pending_control_request = None

    async def stop_session(self, session_id: str) -> None:
        """停止会话，自动路由到 broker 或 hub。"""
        session = self.get_session(session_id)
        if session is None:
            raise ValueError(f"会话 {session_id} 不存在")

        if isinstance(session, ClaudeSession):
            await self._broker.stop_session(session_id)
        elif isinstance(session, RemoteSession):
            await self._hub.stop_remote_session(session)

    async def send_interrupt(self, session_id: str) -> None:
        """发送中断指令，自动路由。"""
        session = self.get_session(session_id)
        if session is None:
            raise ValueError(f"会话 {session_id} 不存在")

        if isinstance(session, ClaudeSession):
            await self._broker.send_interrupt(session_id)
        elif isinstance(session, RemoteSession):
            await self._hub.send_to_agent(session, {"type": "interrupt"})

    async def start_remote_session(
        self,
        agent_id: str,
        project_path: str,
        claude_args: list[str] | None = None,
        name: str | None = None,
    ) -> RemoteSession:
        """在远程 agent 上启动新会话。"""
        return await self._hub.start_remote_session(
            agent_id=agent_id,
            project_path=project_path,
            claude_args=claude_args,
            name=name,
        )
