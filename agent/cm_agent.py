#!/usr/bin/env python3
# cm-agent：Claude Code 的轻量 sidecar，支持 daemon 常驻模式和 oneshot 单次模式
"""
用法：
    # daemon 模式（常驻守护进程，管理多个 Claude 会话）
    cm-agent --server wss://server:8420 --token secret --allowed-paths /home/user/projects

    # oneshot 模式（单次启动，绑定一个 Claude 进程，保持向后兼容）
    cm-agent --server wss://server:8420 --token secret --project /path -- --resume abc123

检测到 -- 参数时自动进入 oneshot 模式，否则进入 daemon 模式。
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import platform
import shutil
import signal
import ssl
import sys
import uuid
from pathlib import Path

try:
    import websockets
    from websockets.asyncio.client import connect as ws_connect
except ImportError:
    print("错误：需要安装 websockets 库。运行: pip install websockets", file=sys.stderr)
    sys.exit(1)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    stream=sys.stderr,
)
logger = logging.getLogger("cm-agent")

# 持久 client_id 配置文件路径
CONFIG_DIR = Path.home() / ".config" / "cm-agent"
CONFIG_FILE = CONFIG_DIR / "agent.json"

# 进程扫描间隔（秒）
PROCESS_SCAN_INTERVAL = 10


def find_claude_bin() -> str:
    """查找 claude 二进制。"""
    if explicit := os.getenv("CLAUDE_BIN"):
        return explicit
    if found := shutil.which("claude"):
        return found
    nvm_root = Path.home() / ".nvm" / "versions" / "node"
    if nvm_root.is_dir():
        for node_dir in sorted(nvm_root.iterdir(), reverse=True):
            candidate = node_dir / "bin" / "claude"
            if candidate.exists():
                return str(candidate)
    return "claude"


def load_or_create_client_id() -> str:
    """加载或创建持久化的 client_id。"""
    if CONFIG_FILE.exists():
        try:
            data = json.loads(CONFIG_FILE.read_text())
            if cid := data.get("client_id"):
                return cid
        except (json.JSONDecodeError, OSError):
            pass

    cid = uuid.uuid4().hex
    try:
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        CONFIG_FILE.write_text(json.dumps({"client_id": cid}, indent=2))
        logger.info("已生成持久 client_id: %s", cid[:8])
    except OSError:
        logger.warning("无法保存 client_id 到 %s", CONFIG_FILE)
    return cid


class ProcessScanner:
    """扫描系统中运行的 Claude Code 进程。"""

    def __init__(self, managed_pids: set[int]) -> None:
        self._managed_pids = managed_pids

    def scan(self) -> list[dict]:
        """扫描 /proc 查找 Claude Code 进程。"""
        processes: list[dict] = []
        proc = Path("/proc")

        try:
            clk_tck = os.sysconf("SC_CLK_TCK")
            system_uptime = float(Path("/proc/uptime").read_text().split()[0])
        except (FileNotFoundError, ValueError, OSError):
            return processes

        my_pid = os.getpid()

        for pid_dir in proc.iterdir():
            if not pid_dir.name.isdigit():
                continue
            pid = int(pid_dir.name)
            if pid == my_pid:
                continue

            try:
                cmdline_bytes = (pid_dir / "cmdline").read_bytes()
                cmdline = cmdline_bytes.replace(b"\x00", b" ").decode("utf-8", errors="replace").strip()
            except (PermissionError, FileNotFoundError, ProcessLookupError):
                continue

            if not cmdline:
                continue

            is_claude = "claude" in cmdline.lower() and (
                "cli.js" in cmdline
                or cmdline.split()[0].endswith("/claude")
                or cmdline.split()[0] == "claude"
            )
            if not is_claude:
                continue
            if "--chrome-native-host" in cmdline:
                continue

            try:
                cwd = str((pid_dir / "cwd").resolve())
            except (PermissionError, FileNotFoundError, OSError):
                cwd = ""

            uptime_seconds = 0.0
            try:
                stat_content = (pid_dir / "stat").read_text()
                after_comm = stat_content.split(")")[1].split()
                start_ticks = int(after_comm[19])
                process_start = start_ticks / clk_tck
                uptime_seconds = max(0, system_uptime - process_start)
            except (IndexError, ValueError, FileNotFoundError, PermissionError):
                pass

            project_name = Path(cwd).name if cwd else None

            processes.append({
                "pid": pid,
                "cwd": cwd,
                "uptime_seconds": round(uptime_seconds, 1),
                "project_name": project_name,
                "managed": pid in self._managed_pids,
            })

        return processes


class AgentSession:
    """管理单个 Claude 子进程。"""

    def __init__(
        self,
        session_id: str,
        project_path: str,
        claude_args: list[str],
        on_event: asyncio.coroutines,
        on_exit: asyncio.coroutines,
    ) -> None:
        self.session_id = session_id
        self.project_path = project_path
        self.claude_args = claude_args
        self._on_event = on_event
        self._on_exit = on_exit
        self.process: asyncio.subprocess.Process | None = None
        self._tasks: list[asyncio.Task] = []

    @property
    def pid(self) -> int | None:
        return self.process.pid if self.process else None

    async def start(self) -> None:
        """启动 Claude 子进程。"""
        claude_bin = find_claude_bin()
        cmd = [
            claude_bin, "-p",
            "--input-format", "stream-json",
            "--output-format", "stream-json",
            "--verbose",
            "--include-partial-messages",
            *self.claude_args,
        ]
        env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}

        logger.info("[session:%s] 启动 Claude: %s", self.session_id[:8], " ".join(cmd))
        logger.info("[session:%s] 工作目录: %s", self.session_id[:8], self.project_path)

        self.process = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=self.project_path,
            env=env,
        )

        self._tasks = [
            asyncio.create_task(self._read_stdout()),
            asyncio.create_task(self._read_stderr()),
            asyncio.create_task(self._wait_exit()),
        ]

    async def stop(self) -> None:
        """停止 Claude 子进程。"""
        if self.process:
            self.process.terminate()
            try:
                await asyncio.wait_for(self.process.wait(), timeout=5)
            except asyncio.TimeoutError:
                self.process.kill()
        for t in self._tasks:
            t.cancel()

    async def send(self, msg: dict) -> None:
        """写入 Claude stdin。"""
        if not self.process or not self.process.stdin:
            return
        data = json.dumps(msg, ensure_ascii=False) + "\n"
        self.process.stdin.write(data.encode("utf-8"))
        await self.process.stdin.drain()

    async def _read_stdout(self) -> None:
        """读取 Claude stdout，转发事件。"""
        assert self.process and self.process.stdout
        try:
            while True:
                line = await self.process.stdout.readline()
                if not line:
                    break
                text = line.decode("utf-8", errors="replace").strip()
                if not text:
                    continue
                try:
                    event = json.loads(text)
                except json.JSONDecodeError:
                    continue
                await self._on_event(self.session_id, event)
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.error("[session:%s] 读取 stdout 异常", self.session_id[:8], exc_info=True)

    async def _read_stderr(self) -> None:
        """读取 Claude stderr。"""
        assert self.process and self.process.stderr
        try:
            while True:
                line = await self.process.stderr.readline()
                if not line:
                    break
                text = line.decode("utf-8", errors="replace").strip()
                if text:
                    logger.debug("[session:%s] stderr: %s", self.session_id[:8], text)
        except (asyncio.CancelledError, Exception):
            pass

    async def _wait_exit(self) -> None:
        """等待进程退出。"""
        if not self.process:
            return
        await self.process.wait()
        exit_code = self.process.returncode
        logger.info("[session:%s] Claude 进程退出: exit_code=%s", self.session_id[:8], exit_code)
        await self._on_exit(self.session_id, exit_code)


class CmAgent:
    """cm-agent 主类：支持 daemon（多会话）和 oneshot（单会话）模式。"""

    def __init__(
        self,
        server_url: str,
        token: str | None,
        mode: str = "daemon",
        allowed_paths: list[str] | None = None,
        no_verify_ssl: bool = False,
        # oneshot 专用参数
        claude_args: list[str] | None = None,
        project_path: str | None = None,
    ) -> None:
        self.server_url = server_url
        self.token = token
        self.mode = mode
        self.allowed_paths = allowed_paths or []
        self.no_verify_ssl = no_verify_ssl
        self.claude_args = claude_args or []
        self.project_path = project_path or os.getcwd()
        self.client_id = load_or_create_client_id() if mode == "daemon" else uuid.uuid4().hex
        self.hostname = platform.node()
        self.ws: websockets.ClientConnection | None = None
        self._running = True
        self._reconnect_delay = 1.0
        self._max_reconnect_delay = 30.0

        # 会话池（daemon 模式下管理多个会话）
        self._sessions: dict[str, AgentSession] = {}
        self._managed_pids: set[int] = set()

    async def run(self) -> None:
        """主入口。"""
        if self.mode == "oneshot":
            await self._run_oneshot()
        else:
            await self._run_daemon()

    async def _run_daemon(self) -> None:
        """daemon 模式：常驻连接，等待服务端指令，扫描进程。"""
        logger.info("cm-agent daemon 模式启动")
        logger.info("允许路径: %s", self.allowed_paths or "(不限)")

        ws_task = asyncio.create_task(self._connect_server())
        scan_task = asyncio.create_task(self._process_scan_loop())

        try:
            # daemon 模式下持续运行，直到收到终止信号
            while self._running:
                await asyncio.sleep(1)
        except asyncio.CancelledError:
            pass
        finally:
            self._running = False
            # 停止所有会话
            for sess in list(self._sessions.values()):
                await sess.stop()
            ws_task.cancel()
            scan_task.cancel()

    async def _run_oneshot(self) -> None:
        """oneshot 模式：启动 Claude 子进程，连接服务端，双向转发（向后兼容）。"""
        # 启动 Claude 子进程
        claude_bin = find_claude_bin()
        cmd = [
            claude_bin, "-p",
            "--input-format", "stream-json",
            "--output-format", "stream-json",
            "--verbose",
            "--include-partial-messages",
            *self.claude_args,
        ]

        env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}

        logger.info("启动 Claude: %s", " ".join(cmd))
        logger.info("工作目录: %s", self.project_path)

        try:
            self._oneshot_process = await asyncio.create_subprocess_exec(
                *cmd,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=self.project_path,
                env=env,
            )
        except FileNotFoundError:
            logger.error("找不到 Claude 命令: %s", claude_bin)
            sys.exit(1)

        stdin_task = asyncio.create_task(self._read_terminal_stdin())
        stdout_task = asyncio.create_task(self._oneshot_read_stdout())
        stderr_task = asyncio.create_task(self._oneshot_read_stderr())
        ws_task = asyncio.create_task(self._connect_server())

        await self._oneshot_process.wait()
        exit_code = self._oneshot_process.returncode
        logger.info("Claude 进程退出: exit_code=%s", exit_code)

        if self.ws:
            try:
                await self.ws.send(json.dumps({
                    "type": "agent_status",
                    "status": "claude_exited",
                    "exit_code": exit_code,
                }))
            except Exception:
                pass

        self._running = False
        stdin_task.cancel()
        ws_task.cancel()

        for task in [stdout_task, stderr_task, stdin_task, ws_task]:
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass

    async def _connect_server(self) -> None:
        """连接服务端 WebSocket，带断线重连。"""
        while self._running:
            url = f"{self.server_url}/ws/agent/{self.client_id}"
            if self.token:
                url += f"?token={self.token}"

            try:
                logger.info("连接服务端: %s", self.server_url)
                # 自签名证书支持
                ws_kwargs: dict = {}
                if self.no_verify_ssl and url.startswith("wss://"):
                    ssl_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
                    ssl_ctx.check_hostname = False
                    ssl_ctx.verify_mode = ssl.CERT_NONE
                    ws_kwargs["ssl"] = ssl_ctx
                async with ws_connect(url, **ws_kwargs) as ws:
                    self.ws = ws
                    self._reconnect_delay = 1.0

                    # 发送注册消息
                    reg: dict = {
                        "type": "register",
                        "client_id": self.client_id,
                        "hostname": self.hostname,
                        "agent_version": "0.2.0",
                        "mode": self.mode,
                    }
                    if self.mode == "daemon":
                        reg["allowed_paths"] = self.allowed_paths
                    else:
                        reg["project_path"] = self.project_path
                        reg["session_id"] = None

                    await ws.send(json.dumps(reg))

                    # 等待注册确认
                    raw = await ws.recv()
                    resp = json.loads(raw)
                    if resp.get("type") == "registered":
                        if self.mode == "daemon":
                            logger.info(
                                "已注册 (daemon): agent_id=%s",
                                resp.get("agent_id", "")[:8],
                            )
                        else:
                            logger.info(
                                "已注册 (oneshot): session_id=%s, name=%s",
                                resp.get("session_id", "")[:8],
                                resp.get("name", ""),
                            )
                    elif resp.get("type") == "error":
                        logger.error("注册失败: %s", resp.get("message"))
                        return

                    # 持续读取服务端下发的消息
                    async for raw in ws:
                        if not self._running:
                            break
                        try:
                            msg = json.loads(raw)
                        except json.JSONDecodeError:
                            continue
                        await self._handle_server_message(msg)

            except (websockets.exceptions.ConnectionClosed, OSError) as e:
                self.ws = None
                if not self._running:
                    break
                logger.warning("服务端连接断开: %s，%ss 后重连", e, self._reconnect_delay)
                await asyncio.sleep(self._reconnect_delay)
                self._reconnect_delay = min(
                    self._reconnect_delay * 2, self._max_reconnect_delay,
                )
            except asyncio.CancelledError:
                break
            except Exception:
                self.ws = None
                if not self._running:
                    break
                logger.error("WebSocket 异常", exc_info=True)
                await asyncio.sleep(self._reconnect_delay)
                self._reconnect_delay = min(
                    self._reconnect_delay * 2, self._max_reconnect_delay,
                )

    async def _handle_server_message(self, msg: dict) -> None:
        """处理服务端下发的消息。"""
        msg_type = msg.get("type")

        if msg_type == "start_session":
            # daemon 模式：服务端请求启动新会话
            await self._handle_start_session(msg)

        elif msg_type == "stop_session":
            # daemon 模式：服务端请求停止会话
            await self._handle_stop_session(msg)

        elif msg_type == "query_processes":
            # daemon 模式：服务端查询进程
            await self._send_processes()

        elif msg_type == "user_message":
            session_id = msg.get("session_id")
            text = msg.get("text", "")
            source = msg.get("source", "web")
            logger.info("[WEB→CLAUDE] %s (from %s, session=%s)", text[:80], source, (session_id or "")[:8])

            target = self._resolve_session(session_id)
            if target:
                await target.send({
                    "type": "user",
                    "message": {"role": "user", "content": text},
                    "parent_tool_use_id": None,
                })
            elif self.mode == "oneshot":
                await self._oneshot_send_to_claude({
                    "type": "user",
                    "message": {"role": "user", "content": text},
                    "parent_tool_use_id": None,
                })

        elif msg_type == "control_response":
            session_id = msg.get("session_id")
            logger.info("[WEB→CLAUDE] control_response: %s", msg.get("request_id", "")[:8])

            target = self._resolve_session(session_id)
            if target:
                await target.send(msg)
            elif self.mode == "oneshot":
                await self._oneshot_send_to_claude(msg)
            print(f"\n[cm-agent] 网页已处理权限请求: {msg.get('behavior', 'allow')}", file=sys.stderr)

        elif msg_type == "interrupt":
            session_id = msg.get("session_id")
            logger.info("[WEB→CLAUDE] interrupt")

            interrupt_msg = {
                "type": "control_request",
                "request_id": uuid.uuid4().hex,
                "request": {"subtype": "interrupt"},
            }
            target = self._resolve_session(session_id)
            if target:
                await target.send(interrupt_msg)
            elif self.mode == "oneshot":
                await self._oneshot_send_to_claude(interrupt_msg)

        elif msg_type == "_permission_handled":
            req_id = msg.get("request_id", "")
            logger.debug("权限已由其他端处理: %s", req_id[:8])

    def _resolve_session(self, session_id: str | None) -> AgentSession | None:
        """根据 session_id 找到 AgentSession。"""
        if session_id and session_id in self._sessions:
            return self._sessions[session_id]
        if len(self._sessions) == 1:
            return next(iter(self._sessions.values()))
        return None

    # --- daemon 模式：会话管理 ---

    async def _handle_start_session(self, msg: dict) -> None:
        """处理服务端的 start_session 请求。"""
        request_id = msg.get("request_id", "")
        project_path = msg.get("project_path", "")
        claude_args = msg.get("claude_args", [])
        name = msg.get("name", "")

        logger.info("收到 start_session 请求: project=%s, name=%s", project_path, name)

        # 安全检查：路径白名单
        if self.allowed_paths:
            allowed = any(
                project_path == p or project_path.startswith(p.rstrip("/") + "/")
                for p in self.allowed_paths
            )
            if not allowed:
                logger.warning("路径 %s 不在白名单中", project_path)
                if self.ws:
                    await self.ws.send(json.dumps({
                        "type": "session_start_failed",
                        "request_id": request_id,
                        "error": f"路径 {project_path} 不在允许的目录列表中",
                    }))
                return

        # 检查路径是否存在
        if not Path(project_path).is_dir():
            if self.ws:
                await self.ws.send(json.dumps({
                    "type": "session_start_failed",
                    "request_id": request_id,
                    "error": f"目录不存在: {project_path}",
                }))
            return

        session_id = uuid.uuid4().hex

        try:
            sess = AgentSession(
                session_id=session_id,
                project_path=project_path,
                claude_args=claude_args,
                on_event=self._on_session_event,
                on_exit=self._on_session_exit,
            )
            await sess.start()
            self._sessions[session_id] = sess
            if sess.pid:
                self._managed_pids.add(sess.pid)

            logger.info("会话已启动: session=%s, pid=%s", session_id[:8], sess.pid)

            if self.ws:
                await self.ws.send(json.dumps({
                    "type": "session_started",
                    "request_id": request_id,
                    "session_id": session_id,
                    "project_path": project_path,
                }))

        except Exception as e:
            logger.error("启动会话失败: %s", e, exc_info=True)
            if self.ws:
                await self.ws.send(json.dumps({
                    "type": "session_start_failed",
                    "request_id": request_id,
                    "error": str(e),
                }))

    async def _handle_stop_session(self, msg: dict) -> None:
        """处理服务端的 stop_session 请求。"""
        session_id = msg.get("session_id", "")
        sess = self._sessions.get(session_id)
        if sess:
            await sess.stop()
            # cleanup 由 _on_session_exit 处理

    async def _on_session_event(self, session_id: str, event: dict) -> None:
        """AgentSession 上报事件的回调。"""
        if self.ws:
            try:
                await self.ws.send(json.dumps({
                    "type": "event",
                    "session_id": session_id,
                    "event": event,
                }))
            except Exception:
                pass

        # 在终端显示关键事件
        self._display_event(event, session_id)

    async def _on_session_exit(self, session_id: str, exit_code: int) -> None:
        """AgentSession 进程退出的回调。"""
        sess = self._sessions.pop(session_id, None)
        if sess and sess.pid:
            self._managed_pids.discard(sess.pid)

        if self.ws:
            try:
                await self.ws.send(json.dumps({
                    "type": "agent_status",
                    "session_id": session_id,
                    "status": "claude_exited",
                    "exit_code": exit_code,
                }))
            except Exception:
                pass

    # --- 进程扫描 ---

    async def _process_scan_loop(self) -> None:
        """定期扫描进程并上报。"""
        scanner = ProcessScanner(self._managed_pids)
        while self._running:
            try:
                await asyncio.sleep(PROCESS_SCAN_INTERVAL)
                await self._send_processes(scanner)
            except asyncio.CancelledError:
                break
            except Exception:
                logger.debug("进程扫描异常", exc_info=True)

    async def _send_processes(self, scanner: ProcessScanner | None = None) -> None:
        """扫描并上报进程列表。"""
        if not self.ws:
            return
        if scanner is None:
            scanner = ProcessScanner(self._managed_pids)
        items = scanner.scan()
        try:
            await self.ws.send(json.dumps({
                "type": "processes",
                "items": items,
            }))
        except Exception:
            pass

    # --- oneshot 模式兼容方法 ---

    async def _oneshot_send_to_claude(self, msg: dict) -> None:
        """写入 Claude stdin（oneshot 模式）。"""
        proc = getattr(self, "_oneshot_process", None)
        if not proc or not proc.stdin:
            return
        data = json.dumps(msg, ensure_ascii=False) + "\n"
        proc.stdin.write(data.encode("utf-8"))
        await proc.stdin.drain()

    async def _oneshot_read_stdout(self) -> None:
        """读取 Claude stdout（oneshot 模式）。"""
        proc = self._oneshot_process
        assert proc and proc.stdout
        try:
            while True:
                line = await proc.stdout.readline()
                if not line:
                    break
                text = line.decode("utf-8", errors="replace").strip()
                if not text:
                    continue
                try:
                    event = json.loads(text)
                except json.JSONDecodeError:
                    continue

                if self.ws:
                    try:
                        await self.ws.send(json.dumps({
                            "type": "event",
                            "event": event,
                        }))
                    except Exception:
                        pass

                self._display_event(event)

        except asyncio.CancelledError:
            pass
        except Exception:
            logger.error("读取 Claude stdout 异常", exc_info=True)

    async def _oneshot_read_stderr(self) -> None:
        """读取 Claude stderr（oneshot 模式）。"""
        proc = self._oneshot_process
        assert proc and proc.stderr
        try:
            while True:
                line = await proc.stderr.readline()
                if not line:
                    break
                text = line.decode("utf-8", errors="replace").strip()
                if text:
                    print(f"[claude stderr] {text}", file=sys.stderr)
        except (asyncio.CancelledError, Exception):
            pass

    async def _read_terminal_stdin(self) -> None:
        """读取终端 stdin，转发到 Claude stdin（终端用户直接输入）。"""
        loop = asyncio.get_event_loop()
        reader = asyncio.StreamReader()
        protocol = asyncio.StreamReaderProtocol(reader)

        try:
            transport, _ = await loop.connect_read_pipe(lambda: protocol, sys.stdin)
        except OSError:
            logger.debug("终端 stdin 不可用")
            return

        try:
            while self._running:
                line = await reader.readline()
                if not line:
                    break
                text = line.decode("utf-8", errors="replace").strip()
                if not text:
                    continue

                if self.mode == "oneshot":
                    await self._oneshot_send_to_claude({
                        "type": "user",
                        "message": {"role": "user", "content": text},
                        "parent_tool_use_id": None,
                    })
                else:
                    # daemon 模式下终端输入不生效
                    logger.debug("daemon 模式忽略终端输入")
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.debug("终端 stdin 读取异常", exc_info=True)
        finally:
            transport.close()

    # --- 事件显示 ---

    def _display_event(self, event: dict, session_id: str | None = None) -> None:
        """在终端显示 Claude 事件（简化输出）。"""
        prefix = f"[session:{session_id[:8]}] " if session_id else ""
        evt_type = event.get("type")

        if evt_type == "system" and event.get("subtype") == "init":
            sid = event.get("session_id", "")
            print(f"[cm-agent] {prefix}会话已初始化: {sid[:12]}...", file=sys.stderr)

        elif evt_type == "stream_event":
            se = event.get("stream_event", {})
            if se.get("type") == "content_block_delta":
                delta = se.get("delta", {})
                if delta.get("type") == "text_delta":
                    print(delta.get("text", ""), end="", flush=True)

        elif evt_type == "result":
            print("", flush=True)

        elif evt_type == "control_request":
            req = event.get("request", {})
            tool_name = req.get("tool_name") or req.get("toolName", "")
            print(f"\n[cm-agent] {prefix}权限请求: {tool_name}", file=sys.stderr)
            print(f"[cm-agent] {prefix}可在终端或网页处理此请求", file=sys.stderr)


def parse_args() -> tuple[argparse.Namespace, list[str], bool]:
    """解析命令行参数。返回 (args, claude_args, is_oneshot)。"""
    # 分离 -- 之后的 Claude 参数
    argv = sys.argv[1:]
    has_double_dash = "--" in argv
    if has_double_dash:
        idx = argv.index("--")
        agent_args = argv[:idx]
        claude_args = argv[idx + 1:]
    else:
        agent_args = argv
        claude_args = []

    parser = argparse.ArgumentParser(
        description="cm-agent：将 Claude Code 接入 ClaudeMaster 服务端",
    )
    parser.add_argument(
        "--server", "-s",
        required=True,
        help="ClaudeMaster 服务端地址（如 wss://my-server:8420 或 ws://localhost:8420）",
    )
    parser.add_argument(
        "--token", "-t",
        default=os.getenv("CM_AUTH_TOKEN"),
        help="认证令牌（也可通过 CM_AUTH_TOKEN 环境变量设置）",
    )
    parser.add_argument(
        "--project", "-p",
        default=os.getcwd(),
        help="项目目录（默认当前目录，oneshot 模式）",
    )
    parser.add_argument(
        "--allowed-paths",
        nargs="*",
        default=[],
        help="daemon 模式允许启动 Claude 的目录列表",
    )
    parser.add_argument(
        "--no-verify-ssl",
        action="store_true",
        default=False,
        help="跳过 SSL 证书验证（用于自签名证书）",
    )

    args = parser.parse_args(agent_args)

    # 检测到 -- 参数时退化为 oneshot 模式
    is_oneshot = has_double_dash

    return args, claude_args, is_oneshot


async def main() -> None:
    args, claude_args, is_oneshot = parse_args()

    mode = "oneshot" if is_oneshot else "daemon"

    agent = CmAgent(
        server_url=args.server.rstrip("/"),
        token=args.token,
        mode=mode,
        allowed_paths=args.allowed_paths,
        no_verify_ssl=args.no_verify_ssl,
        claude_args=claude_args,
        project_path=args.project,
    )

    # 处理 SIGINT/SIGTERM
    loop = asyncio.get_event_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, lambda: asyncio.create_task(_shutdown(agent)))

    await agent.run()


async def _shutdown(agent: CmAgent) -> None:
    """优雅关闭。"""
    logger.info("正在关闭...")
    agent._running = False
    # oneshot 模式终止进程
    proc = getattr(agent, "_oneshot_process", None)
    if proc:
        proc.terminate()
    # daemon 模式停止所有会话
    for sess in list(agent._sessions.values()):
        await sess.stop()


if __name__ == "__main__":
    asyncio.run(main())
