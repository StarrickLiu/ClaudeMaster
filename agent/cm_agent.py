#!/usr/bin/env python3
# cm-agent：Claude Code 的轻量 sidecar，将 Claude CLI 接入 ClaudeMaster 服务端
"""
用法：
    cm-agent --server wss://my-server:8420 --token secret -- --resume abc123

所有 -- 之后的参数透传给 Claude CLI。
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


class CmAgent:
    """cm-agent 主类：管理 Claude 子进程和服务端 WebSocket 连接。"""

    def __init__(
        self,
        server_url: str,
        token: str | None,
        claude_args: list[str],
        project_path: str,
    ) -> None:
        self.server_url = server_url
        self.token = token
        self.claude_args = claude_args
        self.project_path = project_path
        self.client_id = uuid.uuid4().hex
        self.hostname = platform.node()
        self.ws: websockets.ClientConnection | None = None
        self.process: asyncio.subprocess.Process | None = None
        self._running = True
        self._reconnect_delay = 1.0
        self._max_reconnect_delay = 30.0

    async def run(self) -> None:
        """主入口：启动 Claude 子进程，连接服务端，双向转发。"""
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

        # 必须移除 CLAUDECODE 环境变量
        env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}

        logger.info("启动 Claude: %s", " ".join(cmd))
        logger.info("工作目录: %s", self.project_path)

        try:
            self.process = await asyncio.create_subprocess_exec(
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

        # 处理终端 stdin（用户在终端输入）
        stdin_task = asyncio.create_task(self._read_terminal_stdin())
        # 读取 Claude stdout 并转发
        stdout_task = asyncio.create_task(self._read_claude_stdout())
        # 读取 Claude stderr
        stderr_task = asyncio.create_task(self._read_claude_stderr())
        # 连接服务端
        ws_task = asyncio.create_task(self._connect_server())

        # 等待 Claude 进程结束
        await self.process.wait()
        exit_code = self.process.returncode
        logger.info("Claude 进程退出: exit_code=%s", exit_code)

        # 通知服务端
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

        # 等待清理
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
                async with ws_connect(url) as ws:
                    self.ws = ws
                    self._reconnect_delay = 1.0

                    # 发送注册消息
                    reg = {
                        "type": "register",
                        "client_id": self.client_id,
                        "hostname": self.hostname,
                        "project_path": self.project_path,
                        "session_id": None,
                        "agent_version": "0.1.0",
                    }
                    await ws.send(json.dumps(reg))

                    # 等待注册确认
                    raw = await ws.recv()
                    resp = json.loads(raw)
                    if resp.get("type") == "registered":
                        logger.info(
                            "已注册: session_id=%s, name=%s",
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

        if msg_type == "user_message":
            # 网页发送的用户消息 → 写入 Claude stdin
            text = msg.get("text", "")
            source = msg.get("source", "web")
            logger.info("[WEB→CLAUDE] %s (from %s)", text[:80], source)
            await self._send_to_claude({
                "type": "user",
                "message": {"role": "user", "content": text},
                "parent_tool_use_id": None,
            })

        elif msg_type == "control_response":
            # 网页回复的权限请求
            logger.info("[WEB→CLAUDE] control_response: %s", msg.get("request_id", "")[:8])
            await self._send_to_claude(msg)
            # 通知终端权限已处理
            print(f"\n[cm-agent] 网页已处理权限请求: {msg.get('behavior', 'allow')}", file=sys.stderr)

        elif msg_type == "interrupt":
            logger.info("[WEB→CLAUDE] interrupt")
            await self._send_to_claude({
                "type": "control_request",
                "request_id": uuid.uuid4().hex,
                "request": {"subtype": "interrupt"},
            })

        elif msg_type == "_permission_handled":
            # 终端已处理权限，网页无需再操作
            req_id = msg.get("request_id", "")
            logger.debug("权限已由其他端处理: %s", req_id[:8])

    async def _send_to_claude(self, msg: dict) -> None:
        """写入 Claude stdin。"""
        if not self.process or not self.process.stdin:
            return
        data = json.dumps(msg, ensure_ascii=False) + "\n"
        self.process.stdin.write(data.encode("utf-8"))
        await self.process.stdin.drain()

    async def _read_claude_stdout(self) -> None:
        """读取 Claude stdout，同时转发到服务端和终端显示。"""
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

                # 转发到服务端
                if self.ws:
                    try:
                        await self.ws.send(json.dumps({
                            "type": "event",
                            "event": event,
                        }))
                    except Exception:
                        pass

                # 在终端显示关键事件
                self._display_event(event)

        except asyncio.CancelledError:
            pass
        except Exception:
            logger.error("读取 Claude stdout 异常", exc_info=True)

    def _display_event(self, event: dict) -> None:
        """在终端显示 Claude 事件（简化输出）。"""
        evt_type = event.get("type")

        if evt_type == "system" and event.get("subtype") == "init":
            sid = event.get("session_id", "")
            print(f"[cm-agent] 会话已初始化: {sid[:12]}...", file=sys.stderr)

        elif evt_type == "stream_event":
            # 流式输出：提取文本增量显示
            se = event.get("stream_event", {})
            if se.get("type") == "content_block_delta":
                delta = se.get("delta", {})
                if delta.get("type") == "text_delta":
                    print(delta.get("text", ""), end="", flush=True)

        elif evt_type == "result":
            print("", flush=True)  # 换行

        elif evt_type == "control_request":
            req = event.get("request", {})
            tool_name = req.get("tool_name") or req.get("toolName", "")
            print(f"\n[cm-agent] 权限请求: {tool_name}", file=sys.stderr)
            print("[cm-agent] 可在终端或网页处理此请求", file=sys.stderr)

    async def _read_claude_stderr(self) -> None:
        """读取 Claude stderr 并显示。"""
        assert self.process and self.process.stderr
        try:
            while True:
                line = await self.process.stderr.readline()
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
            # stdin 不可用（如后台运行）
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

                # 终端输入直接写入 Claude stdin（不经过服务端）
                await self._send_to_claude({
                    "type": "user",
                    "message": {"role": "user", "content": text},
                    "parent_tool_use_id": None,
                })
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.debug("终端 stdin 读取异常", exc_info=True)
        finally:
            transport.close()


def parse_args() -> tuple[argparse.Namespace, list[str]]:
    """解析命令行参数，-- 之后的参数透传给 Claude。"""
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
        help="项目目录（默认当前目录）",
    )

    # 分离 -- 之后的 Claude 参数
    argv = sys.argv[1:]
    if "--" in argv:
        idx = argv.index("--")
        agent_args = argv[:idx]
        claude_args = argv[idx + 1:]
    else:
        agent_args = argv
        claude_args = []

    args = parser.parse_args(agent_args)
    return args, claude_args


async def main() -> None:
    args, claude_args = parse_args()

    agent = CmAgent(
        server_url=args.server.rstrip("/"),
        token=args.token,
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
    if agent.process:
        agent.process.terminate()


if __name__ == "__main__":
    asyncio.run(main())
