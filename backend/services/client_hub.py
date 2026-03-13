# 远程 cm-agent 会话管理：接收客户端连接，维护 AgentConnection 和 RemoteSession
from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any, Awaitable, Callable

from fastapi import WebSocket

from services.name_generator import generate_name

if TYPE_CHECKING:
    from services.agent_config import AgentConfigStore

logger = logging.getLogger(__name__)

EventCallback = Callable[[dict[str, Any]], Awaitable[None]]

# 断线后保留会话的时间（秒）
DISCONNECT_TIMEOUT = 300  # 5 分钟


@dataclass
class RemoteSession:
    """远程 cm-agent 连接的会话，接口与 ClaudeSession 一致。"""

    session_id: str  # Claude 真实 session_id（从 init 事件获取）
    initial_id: str  # 稳定标识，用于 URL/WS/查找
    agent_id: str  # 所属 agent
    client_id: str  # 向后兼容（= agent_id）
    project_path: str
    hostname: str
    name: str = ""
    state: str = "starting"  # starting | idle | streaming | waiting_permission | closed | disconnected
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


@dataclass
class AgentConnection:
    """一个 cm-agent 守护进程的连接，可管理多个 Claude 会话。"""

    agent_id: str
    hostname: str
    ws: WebSocket | None = None
    mode: str = "daemon"  # "daemon" | "oneshot"
    allowed_paths: list[str] = field(default_factory=list)
    sessions: dict[str, RemoteSession] = field(default_factory=dict)  # session_id -> RemoteSession
    processes: list[dict[str, Any]] = field(default_factory=list)  # 最近上报的进程列表
    remote_sessions: dict[str, dict[str, Any]] = field(default_factory=dict)  # session_id -> 摘要
    state: str = "connected"  # "connected" | "disconnected"
    agent_version: str = ""
    display_name: str = ""
    connected_at: str = ""          # ISO format
    last_heartbeat: str = ""        # ISO format
    latency_ms: float = 0
    _cleanup_task: asyncio.Task[None] | None = field(default=None, repr=False)


class ClientHub:
    """管理所有远程 cm-agent 连接的会话。"""

    def __init__(self, agent_config: AgentConfigStore | None = None) -> None:
        self._sessions: dict[str, RemoteSession] = {}  # 双 key：initial_id + session_id
        self._agents: dict[str, AgentConnection] = {}  # agent_id -> AgentConnection
        self._pending_requests: dict[str, asyncio.Future[dict[str, Any]]] = {}  # request_id -> Future
        self.agent_config: AgentConfigStore | None = agent_config

    def get_session(self, session_id: str) -> RemoteSession | None:
        return self._sessions.get(session_id)

    def get_agent(self, agent_id: str) -> AgentConnection | None:
        return self._agents.get(agent_id)

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
    ) -> AgentConnection | RemoteSession:
        """注册 agent 连接。daemon 模式返回 AgentConnection，oneshot 模式返回 RemoteSession（向后兼容）。"""
        hostname = metadata.get("hostname", "unknown")
        mode = metadata.get("mode", "oneshot")
        agent_version = metadata.get("agent_version", "")
        allowed_paths = metadata.get("allowed_paths", [])

        # daemon 模式：注册 agent 本身，不创建会话
        if mode == "daemon":
            existing_agent = self._agents.get(client_id)
            if existing_agent:
                # 重连
                logger.info("daemon agent 重连: agent_id=%s, hostname=%s", client_id[:8], hostname)
                if existing_agent._cleanup_task:
                    existing_agent._cleanup_task.cancel()
                    existing_agent._cleanup_task = None
                existing_agent.ws = ws
                existing_agent.state = "connected"
                existing_agent.hostname = hostname
                existing_agent.allowed_paths = allowed_paths
                if self.agent_config and not existing_agent.display_name:
                    existing_agent.display_name = self.agent_config.get_display_name(existing_agent.agent_id) or existing_agent.hostname
                # 恢复所有断线会话
                for rs in existing_agent.sessions.values():
                    if rs.state == "disconnected":
                        rs.state = "idle"
                        await rs._notify({"type": "_internal", "subtype": "reconnected"})
                return existing_agent

            agent = AgentConnection(
                agent_id=client_id,
                hostname=hostname,
                ws=ws,
                mode="daemon",
                allowed_paths=allowed_paths,
                agent_version=agent_version,
            )
            agent.connected_at = datetime.now(timezone.utc).isoformat()
            if self.agent_config:
                agent.display_name = self.agent_config.get_display_name(agent.agent_id) or agent.hostname
            else:
                agent.display_name = agent.hostname
            self._agents[client_id] = agent
            logger.info(
                "daemon agent 注册: agent_id=%s, hostname=%s, allowed_paths=%s",
                client_id[:8], hostname, allowed_paths,
            )
            return agent

        # oneshot 模式（向后兼容）：注册 agent 并自动创建会话
        project_path = metadata.get("project_path", "")
        agent_session_id = metadata.get("session_id")

        # 检查是否是断线重连（同 client_id）
        existing = self._sessions.get(client_id)
        if existing and existing.state == "disconnected":
            logger.info("agent 重连: client_id=%s, hostname=%s", client_id, hostname)
            # 确保 agent 连接存在
            agent = self._agents.get(client_id)
            if agent:
                if agent._cleanup_task:
                    agent._cleanup_task.cancel()
                    agent._cleanup_task = None
                agent.ws = ws
                agent.state = "connected"
            existing.state = "idle"
            existing.hostname = hostname
            if project_path:
                existing.project_path = project_path
            await existing._notify({"type": "_internal", "subtype": "reconnected"})
            return existing

        # 新 oneshot 会话
        initial_id = client_id
        session_id = agent_session_id or initial_id

        existing_names = self._active_names()
        name = generate_name(existing_names)

        rs = RemoteSession(
            session_id=session_id,
            initial_id=initial_id,
            agent_id=client_id,
            client_id=client_id,
            project_path=project_path,
            hostname=hostname,
            name=name,
            state="starting",
        )

        self._sessions[initial_id] = rs
        if session_id != initial_id:
            self._sessions[session_id] = rs

        # 创建 agent 连接对象
        agent = AgentConnection(
            agent_id=client_id,
            hostname=hostname,
            ws=ws,
            mode="oneshot",
            agent_version=agent_version,
        )
        agent.sessions[rs.initial_id] = rs
        self._agents[client_id] = agent

        logger.info(
            "oneshot agent 注册: client_id=%s, hostname=%s, project=%s, name=%s",
            client_id, hostname, project_path, name,
        )
        return rs

    async def unregister_agent(self, agent_id: str) -> None:
        """agent 断开连接，标记 disconnected，启动超时清理。"""
        agent = self._agents.get(agent_id)
        if not agent:
            # 向后兼容：直接查 session
            rs = self._sessions.get(agent_id)
            if rs:
                await self._disconnect_session(rs)
            return

        agent.ws = None
        agent.state = "disconnected"

        # 标记所有会话为 disconnected
        has_active = False
        for rs in list(agent.sessions.values()):
            if rs.state == "closed":
                continue
            has_active = True
            rs.state = "disconnected"
            await rs._notify({"type": "_internal", "subtype": "disconnected"})

        if not has_active and agent.mode == "oneshot":
            # oneshot 没有活跃会话，直接清理
            self._cleanup_agent(agent)
            return

        logger.info(
            "agent 断开: agent_id=%s, 将在 %ds 后清理",
            agent_id[:8], DISCONNECT_TIMEOUT,
        )
        agent._cleanup_task = asyncio.create_task(self._delayed_agent_cleanup(agent))

    async def _disconnect_session(self, rs: RemoteSession) -> None:
        """单个会话断线处理（兼容旧逻辑）。"""
        if rs.state == "closed":
            self._cleanup_session(rs)
            return
        rs.state = "disconnected"
        await rs._notify({"type": "_internal", "subtype": "disconnected"})

    async def _delayed_agent_cleanup(self, agent: AgentConnection) -> None:
        """超时后清理断线 agent 及其所有会话。"""
        try:
            await asyncio.sleep(DISCONNECT_TIMEOUT)
            if agent.state == "disconnected":
                logger.info("agent 超时清理: agent_id=%s", agent.agent_id[:8])
                for rs in list(agent.sessions.values()):
                    if rs.state != "closed":
                        rs.state = "closed"
                        await rs._notify({"type": "_internal", "subtype": "closed"})
                    self._cleanup_session(rs)
                self._cleanup_agent(agent)
        except asyncio.CancelledError:
            pass

    def _cleanup_session(self, rs: RemoteSession) -> None:
        """从索引中移除会话的所有 key。"""
        self._sessions.pop(rs.initial_id, None)
        self._sessions.pop(rs.session_id, None)
        # 从 agent 的 sessions 中移除
        agent = self._agents.get(rs.agent_id)
        if agent:
            agent.sessions.pop(rs.initial_id, None)

    def _cleanup_agent(self, agent: AgentConnection) -> None:
        """从索引中移除 agent。"""
        self._agents.pop(agent.agent_id, None)

    def _resolve_session(self, agent: AgentConnection, msg: dict[str, Any]) -> RemoteSession | None:
        """从消息中解析 session_id，找到对应的 RemoteSession。"""
        session_id = msg.get("session_id")
        if session_id:
            # 先从 agent 的会话中找
            rs = agent.sessions.get(session_id)
            if rs:
                return rs
            # 再从全局索引找
            return self._sessions.get(session_id)

        # oneshot 模式：agent 只有一个会话
        if agent.mode == "oneshot" and len(agent.sessions) == 1:
            return next(iter(agent.sessions.values()))

        return None

    async def start_remote_session(
        self,
        agent_id: str,
        project_path: str,
        claude_args: list[str] | None = None,
        name: str | None = None,
    ) -> RemoteSession:
        """向 daemon agent 发送 start_session 命令，等待会话启动。"""
        agent = self._agents.get(agent_id)
        if not agent:
            raise ValueError(f"agent {agent_id} 不存在")
        if agent.state != "connected" or not agent.ws:
            raise ValueError(f"agent {agent_id} 未连接")
        if agent.mode != "daemon":
            raise ValueError(f"agent {agent_id} 不是 daemon 模式")

        # 检查路径白名单
        if agent.allowed_paths:
            allowed = any(
                project_path == p or project_path.startswith(p.rstrip("/") + "/")
                for p in agent.allowed_paths
            )
            if not allowed:
                raise ValueError(
                    f"路径 {project_path} 不在 agent 的白名单中: {agent.allowed_paths}"
                )

        request_id = uuid.uuid4().hex
        existing_names = self._active_names()
        session_name = name or generate_name(existing_names)

        # 发送 start_session 到 agent
        await agent.ws.send_json({
            "type": "start_session",
            "request_id": request_id,
            "project_path": project_path,
            "claude_args": claude_args or [],
            "name": session_name,
        })

        # 等待 agent 回报 session_started 或 session_start_failed
        fut: asyncio.Future[dict[str, Any]] = asyncio.get_event_loop().create_future()
        self._pending_requests[request_id] = fut

        try:
            result = await asyncio.wait_for(fut, timeout=15.0)
        except asyncio.TimeoutError:
            self._pending_requests.pop(request_id, None)
            raise ValueError("等待 agent 启动会话超时")

        if result.get("type") == "session_start_failed":
            raise ValueError(f"agent 启动会话失败: {result.get('error', '未知错误')}")

        # session_started
        session_id = result["session_id"]
        initial_id = session_id  # 用 session_id 作为稳定标识

        rs = RemoteSession(
            session_id=session_id,
            initial_id=initial_id,
            agent_id=agent_id,
            client_id=agent_id,
            project_path=project_path,
            hostname=agent.hostname,
            name=session_name,
            state="starting",
        )

        self._sessions[initial_id] = rs
        agent.sessions[initial_id] = rs

        logger.info(
            "远程会话已启动: agent=%s, session=%s, project=%s, name=%s",
            agent_id[:8], session_id[:8], project_path, session_name,
        )
        return rs

    async def handle_session_started(self, agent: AgentConnection, msg: dict[str, Any]) -> None:
        """处理 agent 上报的 session_started 消息。"""
        request_id = msg.get("request_id", "")
        fut = self._pending_requests.pop(request_id, None)
        if fut and not fut.done():
            fut.set_result(msg)

    async def handle_session_start_failed(self, agent: AgentConnection, msg: dict[str, Any]) -> None:
        """处理 agent 上报的 session_start_failed 消息。"""
        request_id = msg.get("request_id", "")
        fut = self._pending_requests.pop(request_id, None)
        if fut and not fut.done():
            fut.set_result(msg)

    async def handle_processes(self, agent: AgentConnection, msg: dict[str, Any]) -> None:
        """处理 agent 上报的进程列表和会话摘要。"""
        items = msg.get("items", [])
        agent.processes = items

        # 存储远程会话摘要
        sessions = msg.get("sessions", [])
        if sessions:
            agent.remote_sessions = {s["session_id"]: s for s in sessions if s.get("session_id")}
            logger.debug("agent %s 上报 %d 个进程, %d 个会话", agent.agent_id[:8], len(items), len(sessions))
        else:
            logger.debug("agent %s 上报 %d 个进程", agent.agent_id[:8], len(items))

    async def handle_session_detail(self, agent: AgentConnection, msg: dict[str, Any]) -> None:
        """处理 agent 返回的完整会话内容，解锁等待中的 Future。"""
        request_id = msg.get("request_id", "")
        future = self._pending_requests.pop(request_id, None)
        if future and not future.done():
            future.set_result(msg)

    async def request_session_detail(
        self, agent_id: str, session_id: str, project_path: str, timeout: float = 30.0,
    ) -> dict[str, Any] | None:
        """向 agent 请求某个会话的完整 JSONL 内容，等待响应。"""
        agent = self._agents.get(agent_id)
        if not agent or not agent.ws:
            return None

        request_id = uuid.uuid4().hex
        future: asyncio.Future[dict[str, Any]] = asyncio.get_event_loop().create_future()
        self._pending_requests[request_id] = future

        try:
            await agent.ws.send(json.dumps({
                "type": "get_session_detail",
                "request_id": request_id,
                "session_id": session_id,
                "project_path": project_path,
            }))
            result = await asyncio.wait_for(future, timeout=timeout)
            return result
        except asyncio.TimeoutError:
            self._pending_requests.pop(request_id, None)
            logger.warning("请求 session_detail 超时: agent=%s, session=%s", agent_id[:8], session_id[:8])
            return None
        except Exception:
            self._pending_requests.pop(request_id, None)
            return None

    async def handle_pong(self, agent: AgentConnection, msg: dict[str, Any]) -> None:
        """处理 agent 的 pong 响应，更新延迟和心跳。"""
        sent_ts = msg.get("ts", 0)
        now_ms = int(time.time() * 1000)
        agent.latency_ms = max(0, now_ms - sent_ts)
        agent.last_heartbeat = datetime.now(timezone.utc).isoformat()

    async def handle_agent_event(self, agent_or_session: AgentConnection | RemoteSession, event: dict[str, Any], *, session_id: str | None = None) -> None:
        """处理 agent 上报的事件，更新状态并通知 subscribers。"""
        # 解析目标 RemoteSession
        if isinstance(agent_or_session, RemoteSession):
            rs = agent_or_session
        elif isinstance(agent_or_session, AgentConnection):
            agent = agent_or_session
            if session_id:
                rs = agent.sessions.get(session_id) or self._sessions.get(session_id)
            elif agent.mode == "oneshot" and len(agent.sessions) == 1:
                rs = next(iter(agent.sessions.values()))
            else:
                logger.warning("agent %s 上报事件缺少 session_id", agent.agent_id[:8])
                return
            if not rs:
                logger.warning("agent %s 会话 %s 不存在", agent.agent_id[:8], session_id)
                return
        else:
            return

        evt_type = event.get("type")

        if evt_type != "stream_event":
            logger.info(
                "[REMOTE EVT] agent=%s session=%s type=%s subtype=%s",
                rs.agent_id[:8], rs.initial_id[:8], evt_type, event.get("subtype"),
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

    async def handle_agent_status(self, agent_or_session: AgentConnection | RemoteSession, status: dict[str, Any], *, session_id: str | None = None) -> None:
        """处理 agent 状态报告（如 Claude 进程退出）。"""
        # 解析目标 RemoteSession
        if isinstance(agent_or_session, RemoteSession):
            rs = agent_or_session
        elif isinstance(agent_or_session, AgentConnection):
            agent = agent_or_session
            if session_id:
                rs = agent.sessions.get(session_id) or self._sessions.get(session_id)
            elif agent.mode == "oneshot" and len(agent.sessions) == 1:
                rs = next(iter(agent.sessions.values()))
            else:
                logger.warning("agent %s status 缺少 session_id", agent.agent_id[:8])
                return
            if not rs:
                return
        else:
            return

        status_type = status.get("status")
        if status_type == "claude_exited":
            exit_code = status.get("exit_code", -1)
            logger.info("agent 报告 Claude 退出: agent=%s, session=%s, exit_code=%d",
                        rs.agent_id[:8], rs.initial_id[:8], exit_code)
            rs.state = "closed"
            await rs._notify({"type": "_internal", "subtype": "closed"})
            self._cleanup_session(rs)

    async def send_to_agent(self, rs: RemoteSession, message: dict[str, Any]) -> None:
        """发送消息到 agent WebSocket。"""
        agent = self._agents.get(rs.agent_id)
        if not agent or not agent.ws:
            raise ValueError(f"agent 未连接: {rs.agent_id}")
        try:
            # 为 daemon 模式消息附加 session_id
            if agent.mode == "daemon" and "session_id" not in message:
                message = {**message, "session_id": rs.initial_id}
            await agent.ws.send_json(message)
        except Exception as e:
            logger.error("发送到 agent 失败: %s", e)
            raise ValueError(f"发送到 agent 失败: {e}")

    async def stop_remote_session(self, rs: RemoteSession) -> None:
        """停止远程会话。"""
        agent = self._agents.get(rs.agent_id)
        if agent and agent.ws and agent.mode == "daemon":
            try:
                await agent.ws.send_json({
                    "type": "stop_session",
                    "session_id": rs.initial_id,
                })
            except Exception:
                pass

        rs.state = "closed"
        await rs._notify({"type": "_internal", "subtype": "closed"})
        self._cleanup_session(rs)

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
                "agent_id": rs.agent_id,
            }
            if rs.pending_control_request:
                req = rs.pending_control_request.get("request", {})
                item["pending_tool"] = req.get("tool_name") or req.get("toolName")
            result.append(item)
        return result

    def list_agents(self) -> list[dict[str, Any]]:
        """返回所有已连接/断线的 agent 信息。"""
        result = []
        for agent in self._agents.values():
            result.append({
                "agent_id": agent.agent_id,
                "hostname": agent.hostname,
                "state": agent.state,
                "mode": agent.mode,
                "allowed_paths": agent.allowed_paths,
                "agent_version": agent.agent_version,
                "session_count": len(agent.sessions),
                "process_count": len(agent.processes),
                "display_name": agent.display_name,
                "type": "local" if agent.mode == "local" else "remote",
                "latency_ms": agent.latency_ms,
                "last_heartbeat": agent.last_heartbeat,
                "connected_at": agent.connected_at,
            })
        return result

    def get_agent_processes(self, agent_id: str) -> list[dict[str, Any]]:
        """获取某 agent 的远程进程列表。"""
        agent = self._agents.get(agent_id)
        if not agent:
            return []
        # 标记 managed 状态
        managed_pids = set()
        for rs in agent.sessions.values():
            # 这里无法获取 pid，但进程列表中的 managed 字段由 agent 端设置
            pass
        return agent.processes
