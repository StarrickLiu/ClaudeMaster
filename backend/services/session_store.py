# 解析并缓存会话 JSONL 文件
from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from config import PROJECTS_DIR
from models.message import ContentBlock, Message, TokenUsage
from models.session import SessionDetail, SessionSummary, SubagentInfo

# 不进入对话视图的消息类型
SKIP_TYPES = frozenset({
    "progress", "agent_progress", "hook_progress",
    "file-history-snapshot", "direct", "create", "update",
    "queue-operation", "system",
})

# 内存缓存：session_id → (mtime, summary)
_summary_cache: dict[str, tuple[float, SessionSummary]] = {}


def _find_session_file(session_id: str) -> Path | None:
    """在所有项目目录中查找会话 JSONL 文件。"""
    if not PROJECTS_DIR.exists():
        return None
    for project_dir in PROJECTS_DIR.iterdir():
        if not project_dir.is_dir():
            continue
        candidate = project_dir / f"{session_id}.jsonl"
        if candidate.exists():
            return candidate
        # 也可能在子目录中
        candidate2 = project_dir / session_id / f"{session_id}.jsonl"
        if candidate2.exists():
            return candidate2
    return None


def _find_session_file_in_project(session_id: str, project_encoded: str) -> Path | None:
    """在指定项目目录中查找会话文件。"""
    project_dir = PROJECTS_DIR / project_encoded
    if not project_dir.exists():
        return None
    candidate = project_dir / f"{session_id}.jsonl"
    if candidate.exists():
        return candidate
    candidate2 = project_dir / session_id / f"{session_id}.jsonl"
    if candidate2.exists():
        return candidate2
    return None


def _parse_raw_lines(path: Path) -> list[dict[str, Any]]:
    """读取 JSONL 文件，过滤非对话类型和子代理消息。"""
    messages: list[dict[str, Any]] = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue

            msg_type = obj.get("type", "")
            if msg_type in SKIP_TYPES:
                continue
            if obj.get("isSidechain", False):
                continue

            messages.append(obj)
    return messages


def _extract_first_user_text(content: Any) -> str | None:
    """从 content 中提取用户文字。"""
    if isinstance(content, str):
        return content[:200]
    if isinstance(content, list):
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                return (block.get("text") or "")[:200]
    return None


def _is_tool_result_message(obj: dict[str, Any]) -> bool:
    """判断一条 type=user 的消息是否仅包含 tool_result。"""
    content = obj.get("message", {}).get("content")
    if not isinstance(content, list):
        return False
    return all(
        isinstance(b, dict) and b.get("type") == "tool_result"
        for b in content
    )


def _merge_assistant_blocks(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """将同一 requestId 的多个 assistant 行合并为一条消息。"""
    merged: list[dict[str, Any]] = []
    current_request_id: str | None = None
    current_msg: dict[str, Any] | None = None

    for msg in messages:
        request_id = msg.get("requestId")

        if msg.get("type") == "assistant" and request_id:
            if request_id == current_request_id and current_msg is not None:
                # 追加 content blocks
                new_content = msg.get("message", {}).get("content", [])
                cur_content = current_msg.get("message", {}).get("content", [])
                if isinstance(new_content, list) and isinstance(cur_content, list):
                    cur_content.extend(new_content)
                # 更新 usage 为最新的
                new_usage = msg.get("message", {}).get("usage")
                if new_usage:
                    current_msg["message"]["usage"] = new_usage
                # 更新 stop_reason
                new_stop = msg.get("message", {}).get("stop_reason")
                if new_stop:
                    current_msg["message"]["stop_reason"] = new_stop
            else:
                if current_msg is not None:
                    merged.append(current_msg)
                current_msg = msg
                current_request_id = request_id
                # 确保 content 是列表
                content = current_msg.get("message", {}).get("content")
                if isinstance(content, str):
                    current_msg["message"]["content"] = [{"type": "text", "text": content}]
        else:
            if current_msg is not None:
                merged.append(current_msg)
                current_msg = None
                current_request_id = None
            merged.append(msg)

    if current_msg is not None:
        merged.append(current_msg)

    return merged


def _raw_to_message(obj: dict[str, Any]) -> Message:
    """将原始 JSON dict 转换为 Message 模型。"""
    msg_data = obj.get("message", {})

    # 解析 content
    raw_content = msg_data.get("content", "")
    if isinstance(raw_content, list):
        content: str | list[ContentBlock] = [
            ContentBlock(**block) for block in raw_content
            if isinstance(block, dict)
        ]
    else:
        content = str(raw_content) if raw_content else ""

    # 解析 usage
    raw_usage = msg_data.get("usage")
    usage = TokenUsage(**raw_usage) if raw_usage else None

    return Message(
        uuid=obj.get("uuid", ""),
        parentUuid=obj.get("parentUuid"),
        type=obj.get("type", ""),
        timestamp=obj.get("timestamp", ""),
        sessionId=obj.get("sessionId", ""),
        isSidechain=obj.get("isSidechain", False),
        cwd=obj.get("cwd"),
        gitBranch=obj.get("gitBranch"),
        version=obj.get("version"),
        agentId=obj.get("agentId"),
        requestId=obj.get("requestId"),
        role=msg_data.get("role"),
        content=content,
        model_name=msg_data.get("model"),
        usage=usage,
    )


def _extract_assistant_text(content: Any) -> str | None:
    """从 assistant 消息的 content 中提取纯文字部分。"""
    if isinstance(content, str):
        return content[:300] if content else None
    if isinstance(content, list):
        texts: list[str] = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                t = block.get("text", "")
                if t:
                    texts.append(t)
        combined = "\n".join(texts)
        return combined[:300] if combined else None
    return None


def _build_summary(
    session_id: str,
    project_path: str,
    project_name: str,
    messages: list[dict[str, Any]],
    is_active: bool = False,
    resume_session_id: str | None = None,
) -> SessionSummary:
    """从原始消息列表构建会话摘要。"""
    first_message: str | None = None
    last_assistant_text: str | None = None
    start_time: str | None = None
    end_time: str | None = None
    git_branch: str | None = None
    total_input = 0
    total_output = 0
    user_turns = 0
    tool_use_count = 0

    for msg in messages:
        ts = msg.get("timestamp", "")
        if start_time is None:
            start_time = ts
        end_time = ts

        if git_branch is None:
            git_branch = msg.get("gitBranch")

        msg_type = msg.get("type", "")

        if msg_type == "user" and not _is_tool_result_message(msg):
            user_turns += 1
            if first_message is None:
                first_message = _extract_first_user_text(
                    msg.get("message", {}).get("content", "")
                )

        if msg_type == "assistant":
            content = msg.get("message", {}).get("content")
            text = _extract_assistant_text(content)
            if text:
                last_assistant_text = text
            # 统计 tool_use
            if isinstance(content, list):
                tool_use_count += sum(
                    1 for b in content
                    if isinstance(b, dict) and b.get("type") == "tool_use"
                )

        usage = msg.get("message", {}).get("usage")
        if usage:
            total_input += usage.get("input_tokens", 0) + usage.get("cache_read_input_tokens", 0)
            total_output += usage.get("output_tokens", 0)

    return SessionSummary(
        session_id=session_id,
        resume_session_id=resume_session_id,
        project_path=project_path,
        project_name=project_name,
        first_message=first_message,
        last_assistant_text=last_assistant_text,
        user_turns=user_turns,
        tool_use_count=tool_use_count,
        message_count=len(messages),
        start_time=start_time,
        end_time=end_time,
        git_branch=git_branch,
        is_active=is_active,
        total_input_tokens=total_input,
        total_output_tokens=total_output,
    )


def _extract_resume_session_id(path: Path) -> str | None:
    """从 JSONL 文件中提取第一个有效的内部 sessionId（用于 claude --resume）。"""
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                    sid = obj.get("sessionId")
                    if sid and isinstance(sid, str):
                        return sid
                except json.JSONDecodeError:
                    continue
    except OSError:
        pass
    return None


def _get_project_info(project_encoded: str) -> tuple[str, str]:
    """从编码的项目目录名获取项目路径和名称。"""
    from services.project_scanner import _find_best_decode
    project_path = _find_best_decode(project_encoded)
    project_name = Path(project_path).name
    return project_path, project_name


async def get_all_sessions(
    project_encoded: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[SessionSummary], int]:
    """获取所有会话摘要，支持按项目筛选和分页。"""

    def _scan() -> list[SessionSummary]:
        summaries: list[SessionSummary] = []
        if not PROJECTS_DIR.exists():
            return summaries

        dirs = [PROJECTS_DIR / project_encoded] if project_encoded else sorted(PROJECTS_DIR.iterdir())

        for project_dir in dirs:
            if not project_dir.is_dir():
                continue
            encoded = project_dir.name
            project_path, project_name = _get_project_info(encoded)

            for jsonl_file in project_dir.glob("*.jsonl"):
                session_id = jsonl_file.stem
                mtime = jsonl_file.stat().st_mtime

                # 检查缓存
                cached = _summary_cache.get(session_id)
                if cached and cached[0] == mtime:
                    summaries.append(cached[1])
                    continue

                raw = _parse_raw_lines(jsonl_file)
                if not raw:
                    continue
                # 从第一条消息里提取内部 sessionId（用于 claude --resume）
                resume_id = _extract_resume_session_id(jsonl_file)
                summary = _build_summary(session_id, project_path, project_name, raw, resume_session_id=resume_id)
                _summary_cache[session_id] = (mtime, summary)
                summaries.append(summary)

        summaries.sort(key=lambda s: s.end_time or "", reverse=True)
        return summaries

    all_summaries = await asyncio.to_thread(_scan)
    total = len(all_summaries)
    return all_summaries[offset:offset + limit], total


async def get_session_detail(session_id: str, project_encoded: str) -> SessionDetail | None:
    """获取完整会话详情。"""

    def _load() -> SessionDetail | None:
        path = _find_session_file_in_project(session_id, project_encoded)
        if path is None:
            path = _find_session_file(session_id)
        if path is None:
            return None

        raw = _parse_raw_lines(path)
        merged = _merge_assistant_blocks(raw)
        messages = [_raw_to_message(m) for m in merged]

        project_path, project_name = _get_project_info(project_encoded)
        resume_id = _extract_resume_session_id(path)
        summary = _build_summary(session_id, project_path, project_name, raw, resume_session_id=resume_id)

        return SessionDetail(summary=summary, messages=messages)

    return await asyncio.to_thread(_load)


def extract_modified_files(session_id: str) -> list[str]:
    """从会话 JSONL 中提取被 Write/Edit 等工具修改的文件绝对路径。"""
    path = _find_session_file(session_id)
    if not path:
        return []

    # 只扫描 tool_use 相关的 name
    WRITE_TOOLS = {"Write", "Edit", "MultiEdit", "NotebookEdit"}
    modified: set[str] = set()

    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue

            if obj.get("type") != "assistant":
                continue
            content = obj.get("message", {}).get("content")
            if not isinstance(content, list):
                continue

            for block in content:
                if not isinstance(block, dict) or block.get("type") != "tool_use":
                    continue
                name = block.get("name", "")
                if name not in WRITE_TOOLS:
                    continue
                inp = block.get("input", {})
                fp = inp.get("file_path") or inp.get("notebook_path")
                if fp and isinstance(fp, str):
                    modified.add(fp)

    return sorted(modified)


async def search_sessions(
    query: str,
    project_encoded: str | None = None,
    limit: int = 20,
) -> list[dict[str, Any]]:
    """全文搜索会话内容，返回匹配的会话摘要列表（含高亮片段）。"""

    def _search() -> list[dict[str, Any]]:
        q = query.lower()
        results: list[dict[str, Any]] = []
        if not PROJECTS_DIR.exists():
            return results

        dirs = [PROJECTS_DIR / project_encoded] if project_encoded else sorted(PROJECTS_DIR.iterdir())

        for project_dir in dirs:
            if not project_dir.is_dir():
                continue
            encoded = project_dir.name
            project_path, project_name = _get_project_info(encoded)

            for jsonl_file in project_dir.glob("*.jsonl"):
                session_id = jsonl_file.stem
                snippets: list[str] = []
                matched = False

                try:
                    with open(jsonl_file, "r", encoding="utf-8") as f:
                        for line in f:
                            line = line.strip()
                            if not line:
                                continue
                            try:
                                obj = json.loads(line)
                            except json.JSONDecodeError:
                                continue

                            msg_type = obj.get("type", "")
                            if msg_type not in ("user", "assistant"):
                                continue
                            if obj.get("isSidechain", False):
                                continue

                            content = obj.get("message", {}).get("content", "")
                            # 提取纯文本
                            text = ""
                            if isinstance(content, str):
                                text = content
                            elif isinstance(content, list):
                                parts = []
                                for block in content:
                                    if isinstance(block, dict) and block.get("type") == "text":
                                        parts.append(block.get("text", ""))
                                text = " ".join(parts)

                            if q in text.lower():
                                matched = True
                                # 找到匹配位置，截取片段
                                idx = text.lower().find(q)
                                start = max(0, idx - 60)
                                end = min(len(text), idx + len(q) + 80)
                                snippet = ("…" if start > 0 else "") + text[start:end] + ("…" if end < len(text) else "")
                                snippets.append(snippet)
                                if len(snippets) >= 3:
                                    break
                except OSError:
                    continue

                if not matched:
                    continue

                # 构建摘要
                mtime = jsonl_file.stat().st_mtime
                cached = _summary_cache.get(session_id)
                if cached and cached[0] == mtime:
                    summary = cached[1]
                else:
                    raw = _parse_raw_lines(jsonl_file)
                    if not raw:
                        continue
                    resume_id = _extract_resume_session_id(jsonl_file)
                    summary = _build_summary(session_id, project_path, project_name, raw, resume_session_id=resume_id)
                    _summary_cache[session_id] = (mtime, summary)

                results.append({
                    "summary": summary.model_dump(),
                    "snippets": snippets,
                })

                if len(results) >= limit:
                    return results

        results.sort(key=lambda r: r["summary"].get("end_time") or "", reverse=True)
        return results

    return await asyncio.to_thread(_search)


async def get_subagents(session_id: str, project_encoded: str) -> list[SubagentInfo]:
    """获取会话的子代理列表。"""

    def _scan() -> list[SubagentInfo]:
        project_dir = PROJECTS_DIR / project_encoded
        subagents_dir = project_dir / session_id / "subagents"
        if not subagents_dir.exists():
            return []

        result: list[SubagentInfo] = []
        for f in sorted(subagents_dir.glob("agent-*.jsonl")):
            agent_id = f.stem.removeprefix("agent-")
            lines = _parse_raw_lines(f)
            first_msg = None
            for line in lines:
                if line.get("type") == "user":
                    first_msg = _extract_first_user_text(
                        line.get("message", {}).get("content", "")
                    )
                    break
            result.append(SubagentInfo(
                agent_id=agent_id,
                message_count=len(lines),
                first_message=first_msg,
            ))
        return result

    return await asyncio.to_thread(_scan)


async def get_subagent_messages(
    session_id: str, project_encoded: str, agent_id: str,
) -> list[Message] | None:
    """获取子代理完整消息。"""

    def _load() -> list[Message] | None:
        project_dir = PROJECTS_DIR / project_encoded
        path = project_dir / session_id / "subagents" / f"agent-{agent_id}.jsonl"
        if not path.exists():
            return None
        raw = _parse_raw_lines(path)
        merged = _merge_assistant_blocks(raw)
        return [_raw_to_message(m) for m in merged]

    return await asyncio.to_thread(_load)
