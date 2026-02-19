# session_store 核心函数单元测试
from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest

from services.session_store import (
    _build_summary,
    _extract_first_user_text,
    _is_tool_result_message,
    _merge_assistant_blocks,
    _parse_raw_lines,
)


# ── _extract_first_user_text ────────────────────────────────────────────────

def test_extract_first_user_text_string():
    assert _extract_first_user_text("hello") == "hello"


def test_extract_first_user_text_string_truncates():
    long = "x" * 300
    result = _extract_first_user_text(long)
    assert len(result) == 200


def test_extract_first_user_text_list():
    content = [{"type": "text", "text": "world"}]
    assert _extract_first_user_text(content) == "world"


def test_extract_first_user_text_list_skips_non_text():
    content = [{"type": "tool_result", "content": "ignored"}, {"type": "text", "text": "found"}]
    assert _extract_first_user_text(content) == "found"


def test_extract_first_user_text_none():
    assert _extract_first_user_text(None) is None


def test_extract_first_user_text_empty_list():
    assert _extract_first_user_text([]) is None


# ── _is_tool_result_message ─────────────────────────────────────────────────

def test_is_tool_result_message_true():
    obj = {
        "type": "user",
        "message": {"content": [{"type": "tool_result", "tool_use_id": "x"}]},
    }
    assert _is_tool_result_message(obj) is True


def test_is_tool_result_message_false_has_text():
    obj = {
        "type": "user",
        "message": {"content": [{"type": "text", "text": "hi"}, {"type": "tool_result"}]},
    }
    assert _is_tool_result_message(obj) is False


def test_is_tool_result_message_string_content():
    obj = {"type": "user", "message": {"content": "plain text"}}
    assert _is_tool_result_message(obj) is False


def test_is_tool_result_message_empty_content():
    obj = {"type": "user", "message": {"content": []}}
    # all() on empty iterable → True (边界：空列表视为 "只有 tool_result")
    assert _is_tool_result_message(obj) is True


# ── _merge_assistant_blocks ─────────────────────────────────────────────────

def _make_assistant(request_id: str, content: list, usage: dict | None = None) -> dict:
    msg: dict = {
        "type": "assistant",
        "requestId": request_id,
        "message": {"content": content},
    }
    if usage:
        msg["message"]["usage"] = usage
    return msg


def test_merge_same_request_id():
    msgs = [
        _make_assistant("r1", [{"type": "text", "text": "A"}]),
        _make_assistant("r1", [{"type": "text", "text": "B"}]),
    ]
    merged = _merge_assistant_blocks(msgs)
    assert len(merged) == 1
    assert len(merged[0]["message"]["content"]) == 2


def test_merge_different_request_ids():
    msgs = [
        _make_assistant("r1", [{"type": "text", "text": "A"}]),
        _make_assistant("r2", [{"type": "text", "text": "B"}]),
    ]
    merged = _merge_assistant_blocks(msgs)
    assert len(merged) == 2


def test_merge_updates_usage_to_latest():
    msgs = [
        _make_assistant("r1", [], usage={"input_tokens": 10, "output_tokens": 5}),
        _make_assistant("r1", [], usage={"input_tokens": 20, "output_tokens": 15}),
    ]
    merged = _merge_assistant_blocks(msgs)
    assert merged[0]["message"]["usage"]["input_tokens"] == 20


def test_merge_interleaved_non_assistant():
    user_msg = {"type": "user", "message": {"content": "hi"}}
    msgs = [
        _make_assistant("r1", [{"type": "text", "text": "A"}]),
        user_msg,
        _make_assistant("r2", [{"type": "text", "text": "B"}]),
    ]
    merged = _merge_assistant_blocks(msgs)
    assert len(merged) == 3


def test_merge_converts_string_content_to_list():
    msg = {
        "type": "assistant",
        "requestId": "r1",
        "message": {"content": "plain string"},
    }
    merged = _merge_assistant_blocks([msg])
    assert isinstance(merged[0]["message"]["content"], list)
    assert merged[0]["message"]["content"][0]["text"] == "plain string"


# ── _build_summary ──────────────────────────────────────────────────────────

def _make_raw_user(text: str, ts: str = "2024-01-01T00:00:00Z") -> dict:
    return {
        "type": "user",
        "timestamp": ts,
        "message": {"content": text},
    }


def _make_raw_assistant(text: str, ts: str = "2024-01-01T00:01:00Z", usage: dict | None = None) -> dict:
    content = [{"type": "text", "text": text}]
    msg: dict = {"type": "assistant", "timestamp": ts, "message": {"content": content}}
    if usage:
        msg["message"]["usage"] = usage
    return msg


def test_build_summary_basic():
    msgs = [
        _make_raw_user("First question"),
        _make_raw_assistant("First answer"),
    ]
    s = _build_summary("sid", "/proj", "proj", msgs)
    assert s.session_id == "sid"
    assert s.user_turns == 1
    assert s.first_message == "First question"
    assert s.last_assistant_text == "First answer"
    assert s.message_count == 2


def test_build_summary_skips_tool_result_user_messages():
    tool_result_user = {
        "type": "user",
        "timestamp": "2024-01-01T00:00:00Z",
        "message": {"content": [{"type": "tool_result", "tool_use_id": "x"}]},
    }
    msgs = [tool_result_user, _make_raw_assistant("Answer")]
    s = _build_summary("sid", "/proj", "proj", msgs)
    assert s.user_turns == 0
    assert s.first_message is None


def test_build_summary_token_aggregation():
    msgs = [
        _make_raw_user("q"),
        _make_raw_assistant(
            "a",
            usage={"input_tokens": 100, "output_tokens": 50,
                   "cache_read_input_tokens": 20, "cache_creation_input_tokens": 0},
        ),
    ]
    s = _build_summary("sid", "/proj", "proj", msgs)
    # input = 100 + cache_read=20 = 120; output = 50
    assert s.total_input_tokens == 120
    assert s.total_output_tokens == 50


def test_build_summary_tool_use_count():
    msgs = [
        {
            "type": "assistant",
            "timestamp": "2024-01-01T00:00:00Z",
            "message": {
                "content": [
                    {"type": "tool_use", "id": "1", "name": "Bash"},
                    {"type": "tool_use", "id": "2", "name": "Read"},
                ]
            },
        }
    ]
    s = _build_summary("sid", "/proj", "proj", msgs)
    assert s.tool_use_count == 2


def test_build_summary_time_range():
    msgs = [
        _make_raw_user("q", ts="2024-01-01T10:00:00Z"),
        _make_raw_assistant("a", ts="2024-01-01T10:05:00Z"),
    ]
    s = _build_summary("sid", "/proj", "proj", msgs)
    assert s.start_time == "2024-01-01T10:00:00Z"
    assert s.end_time == "2024-01-01T10:05:00Z"


# ── _parse_raw_lines ────────────────────────────────────────────────────────

def _write_jsonl(path: Path, lines: list[dict]) -> None:
    with open(path, "w", encoding="utf-8") as f:
        for line in lines:
            f.write(json.dumps(line) + "\n")


def test_parse_raw_lines_basic(tmp_path):
    p = tmp_path / "session.jsonl"
    _write_jsonl(p, [
        {"type": "user", "message": {"content": "hi"}},
        {"type": "assistant", "message": {"content": "hello"}},
    ])
    result = _parse_raw_lines(p)
    assert len(result) == 2


def test_parse_raw_lines_skips_progress_types(tmp_path):
    p = tmp_path / "session.jsonl"
    _write_jsonl(p, [
        {"type": "progress", "data": "ignored"},
        {"type": "user", "message": {"content": "hi"}},
        {"type": "system", "data": "ignored"},
    ])
    result = _parse_raw_lines(p)
    assert len(result) == 1
    assert result[0]["type"] == "user"


def test_parse_raw_lines_skips_sidechain(tmp_path):
    p = tmp_path / "session.jsonl"
    _write_jsonl(p, [
        {"type": "user", "isSidechain": True, "message": {"content": "side"}},
        {"type": "user", "isSidechain": False, "message": {"content": "main"}},
    ])
    result = _parse_raw_lines(p)
    assert len(result) == 1
    assert result[0]["message"]["content"] == "main"


def test_parse_raw_lines_skips_invalid_json(tmp_path):
    p = tmp_path / "session.jsonl"
    p.write_text('{"type": "user", "message": {"content": "ok"}}\nNOT_JSON\n', encoding="utf-8")
    result = _parse_raw_lines(p)
    assert len(result) == 1


def test_parse_raw_lines_skips_empty_lines(tmp_path):
    p = tmp_path / "session.jsonl"
    p.write_text('\n\n{"type": "user", "message": {"content": "hi"}}\n\n', encoding="utf-8")
    result = _parse_raw_lines(p)
    assert len(result) == 1
