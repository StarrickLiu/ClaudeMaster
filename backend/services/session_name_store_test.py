# session_name_store 单元测试：持久化名称存储
import json
from pathlib import Path
from unittest.mock import patch

import services.session_name_store as sns


def _reset():
    """重置模块级缓存。"""
    sns._names = None


def test_ensure_name_generates_new(tmp_path: Path):
    """对新 session_id 自动生成名称。"""
    _reset()
    store_path = tmp_path / "names.json"
    with patch.object(sns, "_STORE_PATH", store_path):
        name = sns.ensure_name("sess-1")
        assert isinstance(name, str)
        assert "-" in name
        # 持久化到文件
        assert store_path.exists()
        data = json.loads(store_path.read_text())
        assert data["sess-1"] == name


def test_ensure_name_returns_existing(tmp_path: Path):
    """对已有名称的 session_id 直接返回。"""
    _reset()
    store_path = tmp_path / "names.json"
    store_path.write_text(json.dumps({"sess-2": "custom-name"}))
    with patch.object(sns, "_STORE_PATH", store_path):
        name = sns.ensure_name("sess-2")
        assert name == "custom-name"


def test_set_name_persists(tmp_path: Path):
    """set_name 写入后可通过 get_name 读回。"""
    _reset()
    store_path = tmp_path / "names.json"
    with patch.object(sns, "_STORE_PATH", store_path):
        sns.set_name("sess-3", "my-session")
        _reset()  # 清缓存，强制从文件读
        assert sns.get_name("sess-3") == "my-session"


def test_get_name_returns_none_for_unknown(tmp_path: Path):
    """不存在的 session_id 返回 None。"""
    _reset()
    store_path = tmp_path / "names.json"
    with patch.object(sns, "_STORE_PATH", store_path):
        assert sns.get_name("nonexistent") is None


def test_ensure_name_no_duplicate(tmp_path: Path):
    """连续生成多个名称不应重复。"""
    _reset()
    store_path = tmp_path / "names.json"
    with patch.object(sns, "_STORE_PATH", store_path):
        names = set()
        for i in range(10):
            name = sns.ensure_name(f"sess-{i}")
            names.add(name)
        assert len(names) == 10
