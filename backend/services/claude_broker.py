# Claude Code 子进程管理：启动、通信、生命周期
from __future__ import annotations

import asyncio
import json
import logging
import os
import pathlib
import uuid
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from config import CLAUDE_BIN
from services.name_generator import generate_name

logger = logging.getLogger(__name__)

EventCallback = Callable[[dict[str, Any]], Awaitable[None]]


@dataclass
class ClaudeSession:
    """一个运行中的 Claude Code 子进程。"""

    session_id: str
    project_path: str
    process: asyncio.subprocess.Process
    # 初始 UUID（start_session 返回给前端的 ID，始终不变）
    initial_id: str = ""
    name: str = ""
    launch_config: dict[str, Any] = field(default_factory=dict)
    _stdout_task: asyncio.Task[None] | None = field(default=None, repr=False)
    _stderr_task: asyncio.Task[None] | None = field(default=None, repr=False)
    _subscribers: dict[str, EventCallback] = field(default_factory=dict, repr=False)
    state: str = "starting"  # starting | idle | streaming | waiting_permission | closed
    pending_control_request: dict[str, Any] | None = field(default=None, repr=False)

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


class ClaudeBroker:
    """管理所有 Claude Code 子进程的单例。

    架构要点：
    - _sessions 字典同时用 initial_id（UUID）和 session_id（Claude 真实 ID）做 key，
      两个 key 指向同一个 ClaudeSession 对象，保证前端用任一 ID 都能查到。
    - 同一 project_path 允许多个并行会话，每个会话用 Docker 风格名称区分。
    """

    def __init__(self) -> None:
        self._sessions: dict[str, ClaudeSession] = {}

    def get_session(self, session_id: str) -> ClaudeSession | None:
        return self._sessions.get(session_id)

    def _active_names_for_project(self, project_path: str) -> set[str]:
        """返回同项目所有活跃会话的名称集合。"""
        names: set[str] = set()
        seen_ids: set[int] = set()
        for cs in self._sessions.values():
            obj_id = id(cs)
            if obj_id in seen_ids:
                continue
            seen_ids.add(obj_id)
            name = getattr(cs, "name", "")
            if cs.project_path == project_path and cs.state != "closed" and name:
                names.add(name)
        return names

    def _ensure_name(self, cs: ClaudeSession) -> None:
        """确保会话有名称，无则自动生成。兼容旧会话对象。"""
        if getattr(cs, "name", ""):
            return
        existing = self._active_names_for_project(cs.project_path)
        cs.name = generate_name(existing)

    def _unique_sessions(self) -> list[ClaudeSession]:
        """去重返回所有独立会话（因同一对象可能有两个 key）。"""
        seen_ids: set[int] = set()
        result: list[ClaudeSession] = []
        for cs in self._sessions.values():
            obj_id = id(cs)
            if obj_id not in seen_ids:
                seen_ids.add(obj_id)
                result.append(cs)
        return result

    def list_sessions(self) -> list[dict[str, Any]]:
        result = []
        for s in self._unique_sessions():
            self._ensure_name(s)
            item: dict[str, Any] = {
                "session_id": s.initial_id or s.session_id,
                "project_path": s.project_path,
                "state": s.state,
                "name": s.name,
                "launch_config": getattr(s, "launch_config", {}),
                "claude_session_id": s.session_id if s.session_id != s.initial_id else None,
                "pending_tool": None,
            }
            if s.pending_control_request:
                req = s.pending_control_request.get("request", {})
                item["pending_tool"] = req.get("tool_name") or req.get("toolName")
            result.append(item)
        return result

    async def start_session(
        self,
        project_path: str,
        resume_session_id: str | None = None,
        allowed_tools: list[str] | None = None,
        permission_mode: str | None = None,
        max_budget_usd: float | None = None,
        max_turns: int | None = None,
        append_system_prompt: str | None = None,
        model: str | None = None,
        add_dirs: list[str] | None = None,
        name: str | None = None,
    ) -> ClaudeSession:
        """启动 Claude Code 子进程，返回 ClaudeSession。"""

        # ── 去重 1：按 resume_session_id 查找已有会话 ──
        if resume_session_id and resume_session_id in self._sessions:
            cs = self._sessions[resume_session_id]
            if cs.state == "closed":
                pass  # 已关闭，重新启动
            elif cs.state == "starting":
                init_event: asyncio.Event = asyncio.Event()
                async def _on_init_existing(ev: dict[str, Any]) -> None:
                    if ev.get("type") == "system" and ev.get("subtype") == "init":
                        init_event.set()
                sub_id = cs.subscribe(_on_init_existing)
                try:
                    await asyncio.wait_for(init_event.wait(), timeout=10.0)
                except asyncio.TimeoutError:
                    logger.warning("等待已有会话 init 超时: %s", cs.session_id[:8])
                    cs.state = "idle"
                finally:
                    cs.unsubscribe(sub_id)
                self._ensure_name(cs)
                return cs
            else:
                self._ensure_name(cs)
                return cs

        # ── 构建命令行 ──
        cmd = [
            CLAUDE_BIN, "-p",
            "--input-format", "stream-json",
            "--output-format", "stream-json",
            "--verbose",
            "--include-partial-messages",
        ]
        if resume_session_id:
            cmd.extend(["--resume", resume_session_id])
            initial_id = resume_session_id
        else:
            initial_id = uuid.uuid4().hex

        if model:
            cmd.extend(["--model", model])
        if allowed_tools:
            for tool in allowed_tools:
                cmd.extend(["--allowedTools", tool])
        cmd.extend(["--permission-mode", permission_mode or "bypassPermissions"])
        if max_budget_usd is not None:
            cmd.extend(["--max-budget-usd", str(max_budget_usd)])
        if max_turns is not None:
            cmd.extend(["--max-turns", str(max_turns)])
        if append_system_prompt:
            cmd.extend(["--append-system-prompt", append_system_prompt])
        if add_dirs:
            for d in add_dirs:
                cmd.extend(["--add-dir", d])

        # 目录不存在时自动创建
        try:
            pathlib.Path(project_path).mkdir(parents=True, exist_ok=True)
        except PermissionError:
            raise ValueError(f"无权创建项目目录: {project_path}")
        except OSError as e:
            raise ValueError(f"无法创建项目目录: {project_path} ({e})")

        # 必须移除 CLAUDECODE 环境变量，否则报嵌套会话错误
        env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=project_path,
                env=env,
            )
        except FileNotFoundError:
            raise ValueError(f"找不到 Claude 命令: {CLAUDE_BIN}")

        cs = ClaudeSession(
            session_id=initial_id,
            initial_id=initial_id,
            project_path=project_path,
            process=proc,
        )
        # 分配会话名称：用户指定则用用户的，否则自动生成
        if name and name.strip():
            cs.name = name.strip()
        else:
            existing_names = self._active_names_for_project(project_path)
            cs.name = generate_name(existing_names)
        cs.launch_config = {
            "model": model,
            "allowed_tools": allowed_tools,
            "permission_mode": permission_mode or "bypassPermissions",
            "max_budget_usd": max_budget_usd,
            "max_turns": max_turns,
            "append_system_prompt": append_system_prompt,
            "add_dirs": add_dirs,
        }
        # initial_id 作为稳定 key，前端始终用它查找
        self._sessions[initial_id] = cs

        cs._stdout_task = asyncio.create_task(self._read_stdout(cs))
        cs._stderr_task = asyncio.create_task(self._read_stderr(cs))

        # 等待 init 事件获取 Claude 真实 session_id（最多 30 秒）
        new_init_event: asyncio.Event = asyncio.Event()

        async def _on_init(ev: dict[str, Any]) -> None:
            if ev.get("type") == "system" and ev.get("subtype") == "init":
                new_init_event.set()

        sub_id = cs.subscribe(_on_init)
        try:
            await asyncio.wait_for(new_init_event.wait(), timeout=30.0)
        except asyncio.TimeoutError:
            logger.warning("等待 Claude init 超时（30s），session_id=%s", initial_id[:8])
            cs.state = "idle"
        finally:
            cs.unsubscribe(sub_id)

        return cs

    async def send_message(self, session_id: str, text: str) -> None:
        """发送用户消息到 Claude Code stdin。"""
        cs = self._sessions.get(session_id)
        if not cs or not cs.process.stdin:
            raise ValueError(f"会话 {session_id} 不存在或已关闭")
        msg = {
            "type": "user",
            "message": {"role": "user", "content": text},
            "parent_tool_use_id": None,
        }
        data = json.dumps(msg, ensure_ascii=False) + "\n"
        cs.process.stdin.write(data.encode("utf-8"))
        await cs.process.stdin.drain()
        cs.state = "streaming"

    async def send_control_response(
        self,
        session_id: str,
        request_id: str,
        behavior: str = "allow",
        message: str | None = None,
        updated_input: dict[str, Any] | None = None,
    ) -> None:
        """回复工具权限请求。"""
        cs = self._sessions.get(session_id)
        if not cs or not cs.process.stdin:
            raise ValueError(f"会话 {session_id} 不存在或已关闭")
        msg: dict[str, Any] = {
            "type": "control_response",
            "request_id": request_id,
            "behavior": behavior,
        }
        if message:
            msg["message"] = message
        if updated_input:
            msg["updatedInput"] = updated_input
        data = json.dumps(msg, ensure_ascii=False) + "\n"
        logger.info("[PERM] control_response -> stdin: %s", data.strip())
        cs.process.stdin.write(data.encode("utf-8"))
        await cs.process.stdin.drain()
        if cs.pending_control_request and cs.pending_control_request.get("request_id") == request_id:
            cs.pending_control_request = None

    async def send_interrupt(self, session_id: str) -> None:
        """发送中断指令。"""
        cs = self._sessions.get(session_id)
        if not cs or not cs.process.stdin:
            raise ValueError(f"会话 {session_id} 不存在或已关闭")
        msg = {
            "type": "control_request",
            "request_id": uuid.uuid4().hex,
            "request": {"subtype": "interrupt"},
        }
        data = json.dumps(msg, ensure_ascii=False) + "\n"
        cs.process.stdin.write(data.encode("utf-8"))
        await cs.process.stdin.drain()

    async def stop_session(self, session_id: str) -> None:
        """终止指定子进程，清理所有别名 key。"""
        cs = self._sessions.get(session_id)
        if not cs:
            raise ValueError(f"会话 {session_id} 不存在")
        if cs.process.stdin:
            cs.process.stdin.close()
        try:
            cs.process.terminate()
            await asyncio.wait_for(cs.process.wait(), timeout=5.0)
        except (asyncio.TimeoutError, ProcessLookupError):
            cs.process.kill()
        cs.state = "closed"
        # 清理所有指向该 session 的 key（initial_id + session_id）
        self._sessions.pop(cs.initial_id, None)
        self._sessions.pop(cs.session_id, None)

    async def shutdown(self) -> None:
        """关闭所有子进程（应用退出时调用）。"""
        for cs in list(self._unique_sessions()):
            try:
                await self.stop_session(cs.session_id)
            except Exception:
                logger.debug("关闭会话 %s 失败", cs.session_id, exc_info=True)

    async def _read_stdout(self, cs: ClaudeSession) -> None:
        """持续读取子进程 stdout，解析 JSON 行，通知订阅者。"""
        assert cs.process.stdout is not None
        try:
            while True:
                line = await cs.process.stdout.readline()
                if not line:
                    break
                text = line.decode("utf-8", errors="replace").strip()
                if not text:
                    continue
                try:
                    event = json.loads(text)
                except json.JSONDecodeError:
                    logger.info("[RAW] non-JSON stdout: %s", text[:300])
                    continue

                evt_type = event.get("type")
                if evt_type != "stream_event":
                    logger.info("[EVT] type=%s subtype=%s content=%s",
                                evt_type, event.get("subtype"),
                                json.dumps(event, ensure_ascii=False)[:600])

                # 从 init 事件更新 session_id，保留 initial_id 别名
                if event.get("type") == "system" and event.get("subtype") == "init":
                    real_id = event.get("session_id", cs.session_id)
                    if real_id != cs.session_id:
                        logger.info("session_id 更新: %s → %s", cs.session_id[:8], real_id[:8])
                        cs.session_id = real_id
                        # 追加真实 ID 为新 key，initial_id key 保留不动
                        self._sessions[real_id] = cs
                    cs.state = "idle"

                # 更新状态
                event_type = event.get("type")
                if event_type == "stream_event":
                    if cs.state == "waiting_permission" and cs.pending_control_request:
                        logger.info("[PERM] Claude 已自动批准，清除 pending_control_request")
                        cs.pending_control_request = None
                    cs.state = "streaming"
                elif event_type == "control_request":
                    cs.state = "waiting_permission"
                    cs.pending_control_request = event
                    logger.info("[PERM] control_request: %s", json.dumps(event, ensure_ascii=False)[:500])
                elif event_type == "result":
                    cs.state = "idle"
                    cs.pending_control_request = None

                await cs._notify(event)
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.error("读取 stdout 异常", exc_info=True)
        finally:
            if cs.state != "closed":
                cs.state = "closed"
                await cs._notify({"type": "_internal", "subtype": "closed"})
                # 清理所有别名
                self._sessions.pop(cs.initial_id, None)
                self._sessions.pop(cs.session_id, None)

    async def _read_stderr(self, cs: ClaudeSession) -> None:
        """读取并记录子进程 stderr。"""
        assert cs.process.stderr is not None
        try:
            while True:
                line = await cs.process.stderr.readline()
                if not line:
                    break
                text = line.decode("utf-8", errors="replace").strip()
                if text:
                    logger.info("[STDERR] Claude [%s]: %s", cs.session_id[:8], text)
        except (asyncio.CancelledError, Exception):
            pass


# 模块级单例
broker = ClaudeBroker()
