# 交互式会话 API 单元测试
from __future__ import annotations

import asyncio
import json
import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient


# ─── 辅助：构造一个会在 stdout 输出 init 事件的假 Claude 进程 ───────────────

class FakeProcess:
    """模拟 Claude Code 子进程，输出 init JSON，然后 EOF。"""

    def __init__(self, session_id: str = "fake-session-001", exit_code: int = 0):
        self._session_id = session_id
        self._exit_code = exit_code
        self._init_sent = False

        # stdin mock
        self.stdin = AsyncMock()
        self.stdin.write = MagicMock()
        self.stdin.drain = AsyncMock()
        self.stdin.close = MagicMock()

        # stdout: 输出 init 事件行后停止
        init_line = json.dumps({
            "type": "system",
            "subtype": "init",
            "session_id": self._session_id,
        }).encode() + b"\n"
        self._lines = [init_line]
        self.stdout = self._make_stdout_reader()

        # stderr: 空
        async def _empty_readline():
            return b""

        self.stderr = AsyncMock()
        self.stderr.readline = _empty_readline

        self.pid = 99999
        self.returncode = None

    def _make_stdout_reader(self):
        lines = list(self._lines)

        class FakeStdout:
            def __init__(self):
                self._lines = list(lines)
                self._done = False

            async def readline(self):
                if self._lines:
                    return self._lines.pop(0)
                # 阻塞直到测试结束（模拟进程持续运行）
                await asyncio.sleep(3600)
                return b""

        return FakeStdout()

    async def wait(self):
        return self._exit_code

    def terminate(self):
        pass

    def kill(self):
        pass


# ─── 配置 & 二进制查找测试 ────────────────────────────────────────────────────

class TestClaudeBinDiscovery:
    """测试 _find_claude_bin() 的三种路径。"""

    def test_env_var_wins(self, tmp_path):
        """CLAUDE_BIN 环境变量优先级最高。"""
        fake_bin = tmp_path / "claude"
        fake_bin.touch()

        with patch.dict(os.environ, {"CLAUDE_BIN": str(fake_bin)}):
            from config import _find_claude_bin
            assert _find_claude_bin() == str(fake_bin)

    def test_which_fallback(self):
        """shutil.which 作为次级查找。"""
        with patch.dict(os.environ, {}, clear=False):
            env = {k: v for k, v in os.environ.items() if k != "CLAUDE_BIN"}
            with patch.dict(os.environ, env, clear=True):
                with patch("shutil.which", return_value="/usr/local/bin/claude"):
                    from config import _find_claude_bin
                    result = _find_claude_bin()
                    assert result == "/usr/local/bin/claude"

    def test_nvm_scan_fallback(self, tmp_path):
        """当 which 找不到时，扫描 nvm 目录。"""
        # 构造虚假 nvm 结构
        nvm_root = tmp_path / ".nvm" / "versions" / "node"
        v_dir = nvm_root / "v20.0.0"
        (v_dir / "bin").mkdir(parents=True)
        fake_claude = v_dir / "bin" / "claude"
        fake_claude.touch()

        # 直接测试 _find_claude_bin 函数逻辑（绕过模块缓存）
        with patch.dict(os.environ, {}, clear=True):
            with patch("shutil.which", return_value=None):
                with patch("pathlib.Path.home", return_value=tmp_path):
                    from config import _find_claude_bin
                    result = _find_claude_bin()
                    assert result == str(fake_claude), f"期望找到 {fake_claude}，实际: {result}"

    def test_real_claude_bin_exists(self):
        """实际环境中 _find_claude_bin() 应该返回可执行的二进制。"""
        from config import _find_claude_bin
        # 用真实环境调用（不 mock），验证实际查找结果
        result = _find_claude_bin()
        assert os.path.exists(result), (
            f"claude CLI 不存在: {result!r}，请确认已安装"
        )
        assert os.access(result, os.X_OK), (
            f"claude CLI 不可执行: {result!r}"
        )


# ─── Broker 单元测试（mock 子进程）────────────────────────────────────────────

class TestClaudeBroker:

    @pytest.fixture(autouse=True)
    def fresh_broker(self):
        """每个测试使用独立的 broker 实例（避免状态泄漏）。"""
        from services.claude_broker import ClaudeBroker
        self.broker = ClaudeBroker()
        yield
        # 清理（不等待，只强制 close 状态）
        for cs in list(self.broker._sessions.values()):
            cs.state = "closed"

    @pytest.mark.asyncio
    async def test_start_session_file_not_found(self):
        """CLAUDE_BIN 找不到时应抛出 ValueError。"""
        with patch("services.claude_broker.CLAUDE_BIN", "/nonexistent/claude"):
            with pytest.raises(ValueError, match="找不到 Claude 命令"):
                await self.broker.start_session("/tmp")

    @pytest.mark.asyncio
    async def test_start_session_invalid_cwd(self):
        """无权限的目录应抛出 ValueError。"""
        with pytest.raises(ValueError, match="无权创建项目目录"):
            await self.broker.start_session("/nonexistent/project/path")

    @pytest.mark.asyncio
    async def test_start_session_success(self, tmp_path):
        """正常流程：mock 子进程 → 等 init → 返回 ClaudeSession。"""
        fake_proc = FakeProcess(session_id="test-real-id-001")

        with patch("asyncio.create_subprocess_exec", return_value=fake_proc):
            cs = await asyncio.wait_for(
                self.broker.start_session(str(tmp_path)),
                timeout=5.0,
            )

        assert cs.session_id == "test-real-id-001"
        assert cs.state == "idle"
        assert cs.project_path == str(tmp_path)

    @pytest.mark.asyncio
    async def test_start_session_stores_in_dict(self, tmp_path):
        """成功启动后，会话应出现在 _sessions 字典中。"""
        fake_proc = FakeProcess(session_id="stored-session-abc")

        with patch("asyncio.create_subprocess_exec", return_value=fake_proc):
            cs = await asyncio.wait_for(
                self.broker.start_session(str(tmp_path)),
                timeout=5.0,
            )

        assert "stored-session-abc" in self.broker._sessions
        assert self.broker.get_session("stored-session-abc") is cs

    @pytest.mark.asyncio
    async def test_start_session_resume_existing(self, tmp_path):
        """同一 session_id 的 idle 会话直接返回，不再启动新进程。"""
        fake_proc = FakeProcess(session_id="resume-me-123")

        with patch("asyncio.create_subprocess_exec", return_value=fake_proc):
            cs1 = await asyncio.wait_for(
                self.broker.start_session(str(tmp_path), resume_session_id="resume-me-123"),
                timeout=5.0,
            )

        # 第二次请求同一 session_id
        call_count = 0
        original_create = asyncio.create_subprocess_exec

        async def counting_create(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            return await original_create(*args, **kwargs)

        with patch("asyncio.create_subprocess_exec", side_effect=counting_create):
            cs2 = await asyncio.wait_for(
                self.broker.start_session(str(tmp_path), resume_session_id="resume-me-123"),
                timeout=5.0,
            )

        assert cs1 is cs2, "应返回同一 session 对象"
        assert call_count == 0, "不应再次调用 create_subprocess_exec"

    @pytest.mark.asyncio
    async def test_list_sessions(self, tmp_path):
        """list_sessions 应返回所有活跃会话的摘要。"""
        fake_proc = FakeProcess(session_id="list-test-abc")

        with patch("asyncio.create_subprocess_exec", return_value=fake_proc):
            await asyncio.wait_for(
                self.broker.start_session(str(tmp_path)),
                timeout=5.0,
            )

        sessions = self.broker.list_sessions()
        assert len(sessions) == 1
        # list_sessions 返回 initial_id（UUID），非真实 session_id
        assert sessions[0]["state"] == "idle"
        assert sessions[0]["project_path"] == str(tmp_path)

    @pytest.mark.asyncio
    async def test_parallel_sessions_same_project(self, tmp_path):
        """同一 project_path 可创建多个并行会话。"""
        fake_proc1 = FakeProcess(session_id="dedup-001")
        fake_proc2 = FakeProcess(session_id="dedup-002")

        with patch("asyncio.create_subprocess_exec", return_value=fake_proc1):
            cs1 = await asyncio.wait_for(
                self.broker.start_session(str(tmp_path)),
                timeout=5.0,
            )

        with patch("asyncio.create_subprocess_exec", return_value=fake_proc2):
            cs2 = await asyncio.wait_for(
                self.broker.start_session(str(tmp_path)),
                timeout=5.0,
            )

        assert cs1 is not cs2, "同一项目应允许创建多个并行会话"
        assert cs1.initial_id != cs2.initial_id
        sessions = self.broker.list_sessions()
        assert len(sessions) == 2

    @pytest.mark.asyncio
    async def test_initial_id_alias(self, tmp_path):
        """init 后 initial_id 和真实 id 都应能查到同一 session。"""
        fake_proc = FakeProcess(session_id="real-claude-xyz")

        with patch("asyncio.create_subprocess_exec", return_value=fake_proc):
            cs = await asyncio.wait_for(
                self.broker.start_session(str(tmp_path)),
                timeout=5.0,
            )

        # initial_id 是 UUID，session_id 是真实 ID
        assert cs.initial_id != cs.session_id
        assert self.broker.get_session(cs.initial_id) is cs
        assert self.broker.get_session(cs.session_id) is cs

    @pytest.mark.asyncio
    async def test_stop_nonexistent_session(self):
        """停止不存在的会话应抛出 ValueError。"""
        with pytest.raises(ValueError, match="不存在"):
            await self.broker.stop_session("ghost-id")

    @pytest.mark.asyncio
    async def test_send_message(self, tmp_path):
        """send_message 应向 stdin 写入正确格式的 JSON。"""
        fake_proc = FakeProcess(session_id="msg-test-xyz")

        with patch("asyncio.create_subprocess_exec", return_value=fake_proc):
            cs = await asyncio.wait_for(
                self.broker.start_session(str(tmp_path)),
                timeout=5.0,
            )

        await self.broker.send_message(cs.session_id, "你好，Claude")

        # 验证 stdin.write 被调用
        assert fake_proc.stdin.write.called
        written_bytes = fake_proc.stdin.write.call_args[0][0]
        written_data = json.loads(written_bytes.decode("utf-8").strip())
        assert written_data["type"] == "user"
        assert written_data["message"]["role"] == "user"
        assert "你好，Claude" in written_data["message"]["content"]
        assert cs.state == "streaming"

    @pytest.mark.asyncio
    async def test_send_message_nonexistent(self):
        """对不存在的会话发消息应抛出 ValueError。"""
        with pytest.raises(ValueError):
            await self.broker.send_message("ghost-id", "hello")


# ─── API 端点集成测试 ─────────────────────────────────────────────────────────

@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.asyncio
class TestChatAPI:

    @pytest.fixture
    async def client(self):
        from main import app
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as c:
            yield c

    async def test_start_chat_bad_project_path(self, client):
        """无权限的 project_path 应返回 400。"""
        resp = await client.post("/api/chat/start", json={
            "project_path": "/absolutely/nonexistent/path/xyz123",
            "resume_session_id": None,
            "allowed_tools": None,
            "permission_mode": None,
            "max_budget_usd": None,
            "max_turns": None,
            "append_system_prompt": None,
            "model": None,
            "add_dirs": None,
        })
        # 无权限创建目录 → ValueError → 400
        assert resp.status_code == 400
        body = resp.json()
        assert "detail" in body
        assert "无权创建" in body["detail"]

    async def test_start_chat_missing_project_path(self, client):
        """缺少必填字段 project_path 应返回 422。"""
        resp = await client.post("/api/chat/start", json={})
        assert resp.status_code == 422

    async def test_start_chat_mocked(self, client, tmp_path):
        """mock 子进程，完整测试 /api/chat/start 端点。"""
        from services import claude_broker
        fake_proc = FakeProcess(session_id="api-test-session-001")

        with patch("asyncio.create_subprocess_exec", return_value=fake_proc):
            resp = await asyncio.wait_for(
                client.post("/api/chat/start", json={
                    "project_path": str(tmp_path),
                    "resume_session_id": None,
                    "allowed_tools": None,
                    "permission_mode": None,
                    "max_budget_usd": None,
                    "max_turns": None,
                    "append_system_prompt": None,
                    "model": None,
                    "add_dirs": None,
                }),
                timeout=10.0,
            )

        assert resp.status_code == 200
        data = resp.json()
        # API 返回 initial_id（UUID），不是真实 session_id
        assert data["state"] == "idle"
        assert data["project_path"] == str(tmp_path)
        returned_id = data["session_id"]

        # 清理：通过返回的 ID 查找并清除
        broker_instance = claude_broker.broker
        cs = broker_instance.get_session(returned_id)
        if cs:
            cs.state = "closed"
            broker_instance._sessions.pop(cs.initial_id, None)
            broker_instance._sessions.pop(cs.session_id, None)

    async def test_list_chat_sessions(self, client):
        """/api/chat/sessions 端点应正常响应（空列表或活跃列表）。"""
        resp = await client.get("/api/chat/sessions")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    async def test_stop_nonexistent_session(self, client):
        """停止不存在的会话应返回 404。"""
        resp = await client.post("/api/chat/ghost-id/stop")
        assert resp.status_code == 404

    async def test_start_chat_with_options(self, client, tmp_path):
        """带高级选项启动会话（model, permission_mode 等）。"""
        fake_proc = FakeProcess(session_id="opts-test-001")

        with patch("asyncio.create_subprocess_exec", return_value=fake_proc) as mock_exec:
            resp = await asyncio.wait_for(
                client.post("/api/chat/start", json={
                    "project_path": str(tmp_path),
                    "resume_session_id": None,
                    "allowed_tools": ["Read", "Bash"],
                    "permission_mode": "acceptEdits",
                    "max_budget_usd": 1.5,
                    "max_turns": 10,
                    "append_system_prompt": "请用中文回复",
                    "model": "sonnet",
                    "add_dirs": ["/tmp"],
                }),
                timeout=10.0,
            )

        assert resp.status_code == 200
        # 验证命令行参数包含正确选项
        cmd_args = mock_exec.call_args[0]
        cmd_str = " ".join(str(a) for a in cmd_args)
        assert "--model" in cmd_str
        assert "sonnet" in cmd_str
        assert "--permission-mode" in cmd_str
        assert "acceptEdits" in cmd_str
        assert "--allowedTools" in cmd_str
        assert "--max-budget-usd" in cmd_str
        assert "--max-turns" in cmd_str
        assert "--append-system-prompt" in cmd_str
        assert "--add-dir" in cmd_str

        # 清理
        from services import claude_broker
        broker_instance = claude_broker.broker
        for key in list(broker_instance._sessions.keys()):
            cs = broker_instance._sessions[key]
            if cs.project_path == str(tmp_path):
                cs.state = "closed"
                broker_instance._sessions.pop(cs.initial_id, None)
                broker_instance._sessions.pop(cs.session_id, None)
                break


# ─── 环境变量过滤测试 ─────────────────────────────────────────────────────────

class TestEnvFiltering:
    """确保 CLAUDECODE 环境变量被过滤（防止嵌套会话错误）。"""

    @pytest.mark.asyncio
    async def test_claudecode_env_removed(self, tmp_path):
        from services.claude_broker import ClaudeBroker
        broker = ClaudeBroker()

        captured_env = {}

        async def fake_exec(*args, env=None, **kwargs):
            if env:
                captured_env.update(env)
            fake = FakeProcess()
            return fake

        with patch.dict(os.environ, {"CLAUDECODE": "1", "HOME": os.environ.get("HOME", "/root")}):
            with patch("asyncio.create_subprocess_exec", side_effect=fake_exec):
                cs = await asyncio.wait_for(
                    broker.start_session(str(tmp_path)),
                    timeout=5.0,
                )

        assert "CLAUDECODE" not in captured_env, "CLAUDECODE 应被从子进程环境中移除"
        assert "HOME" in captured_env, "其他环境变量应被保留"
