# diff 路由单元测试：mock git 子进程，验证 API 响应
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient


# ── 应用 fixture ─────────────────────────────────────────────────────────────

@pytest.fixture()
def client():
    """使用 TestClient 测试 FastAPI 应用，不依赖真实 git 仓库。"""
    from main import app
    return TestClient(app)


# ── _run_git mock helper ─────────────────────────────────────────────────────

def _mock_run_git(return_value: str):
    """返回一个替换 _run_git 的 AsyncMock。"""
    async def _fake(*args, **kwargs):
        return return_value
    return _fake


# ── GET /api/diff ────────────────────────────────────────────────────────────

class TestGetDiff:
    def test_returns_diff_and_stat(self, client):
        diff_output = "diff --git a/foo.py b/foo.py\n+new line\n-old line\n"
        stat_output = " foo.py | 2 +-\n 1 file changed"
        call_count = 0

        async def _fake_run_git(project_path, *args, **kwargs):
            nonlocal call_count
            call_count += 1
            if "--stat" in args:
                return stat_output
            return diff_output

        with patch("routers.diff._run_git", side_effect=_fake_run_git):
            resp = client.get("/api/diff", params={"project_path": "/fake/project"})

        assert resp.status_code == 200
        data = resp.json()
        assert "diff" in data
        assert "stat" in data

    def test_returns_empty_for_clean_repo(self, client):
        with patch("routers.diff._run_git", side_effect=_mock_run_git("")):
            resp = client.get("/api/diff", params={"project_path": "/fake/project"})
        assert resp.status_code == 200
        assert resp.json()["diff"] == ""

    def test_missing_project_path_returns_422(self, client):
        resp = client.get("/api/diff")
        assert resp.status_code == 422


# ── GET /api/commits ─────────────────────────────────────────────────────────

class TestGetCommits:
    _log = (
        "abc1234567890abcdef\x1fAdd feature\x1fAlice\x1f2024-01-15T10:00:00+08:00\n"
        "def9876543210fedcba\x1fFix bug\x1fBob\x1f2024-01-14T09:30:00+08:00\n"
    )
    _stat = " 2 files changed, 10 insertions(+), 3 deletions(-)\n"

    def test_returns_commit_list(self, client):
        call_count = 0

        async def _fake(project_path, *args, **kwargs):
            nonlocal call_count
            call_count += 1
            if "log" in args:
                return self._log
            return self._stat  # show --stat

        with patch("routers.diff._run_git", side_effect=_fake):
            resp = client.get("/api/commits", params={"project_path": "/fake"})

        assert resp.status_code == 200
        commits = resp.json()
        assert len(commits) == 2
        assert commits[0]["subject"] == "Add feature"
        assert commits[0]["author"] == "Alice"
        assert commits[0]["short_hash"] == "abc1234"

    def test_parses_insertions_deletions(self, client):
        async def _fake(project_path, *args, **kwargs):
            if "log" in args:
                return "aaa1234567890\x1fTest\x1fX\x1f2024-01-01T00:00:00Z\n"
            return " 5 files changed, 42 insertions(+), 7 deletions(-)\n"

        with patch("routers.diff._run_git", side_effect=_fake):
            resp = client.get("/api/commits", params={"project_path": "/fake"})

        c = resp.json()[0]
        assert c["insertions"] == 42
        assert c["deletions"] == 7
        assert c["files_changed"] == 5

    def test_empty_repo_returns_empty_list(self, client):
        with patch("routers.diff._run_git", side_effect=_mock_run_git("")):
            resp = client.get("/api/commits", params={"project_path": "/fake"})
        assert resp.status_code == 200
        assert resp.json() == []

    def test_limit_parameter_respected(self, client):
        async def _fake(project_path, *args, **kwargs):
            # 验证 -N flag 传递了正确的限制
            limit_flag = next((a for a in args if a.startswith("-") and a[1:].isdigit()), None)
            assert limit_flag == "-5"
            return ""

        with patch("routers.diff._run_git", side_effect=_fake):
            resp = client.get("/api/commits", params={"project_path": "/fake", "limit": 5})
        assert resp.status_code == 200

    def test_missing_project_path_returns_422(self, client):
        resp = client.get("/api/commits")
        assert resp.status_code == 422


# ── GET /api/commit ──────────────────────────────────────────────────────────

class TestGetCommitDiff:
    def test_returns_commit_diff(self, client):
        diff_text = "diff --git a/foo.py b/foo.py\n+added\n"
        with patch("routers.diff._run_git", side_effect=_mock_run_git(diff_text)):
            resp = client.get("/api/commit", params={"project_path": "/fake", "hash": "abc1234"})

        assert resp.status_code == 200
        assert resp.json()["diff"] == diff_text

    def test_missing_params_returns_422(self, client):
        resp = client.get("/api/commit", params={"project_path": "/fake"})
        assert resp.status_code == 422

        resp = client.get("/api/commit", params={"hash": "abc"})
        assert resp.status_code == 422
