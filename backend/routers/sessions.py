# 会话相关 API
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from models.message import Message
from models.session import SessionDetail, SessionSummary, SubagentInfo
from services.session_name_store import set_name
from services.session_store import (
    get_all_sessions,
    get_session_detail,
    get_subagent_messages,
    get_subagents,
    search_sessions,
)

router = APIRouter(tags=["会话"])


@router.get(
    "/sessions",
    summary="获取会话列表",
    description="按项目筛选、分页返回会话摘要。",
)
async def list_sessions(
    project: str | None = Query(None, description="编码后的项目目录名"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict:
    items, total = await get_all_sessions(project, limit, offset)
    return {"items": items, "total": total}


@router.get(
    "/sessions/search",
    summary="全文搜索会话",
    description="在所有会话的用户/助手消息中搜索关键字，返回匹配的会话列表及高亮片段。",
)
async def search(
    q: str = Query(..., description="搜索关键字"),
    project: str | None = Query(None, description="编码后的项目目录名"),
    limit: int = Query(20, ge=1, le=100),
) -> dict:
    if not q.strip():
        return {"items": [], "total": 0}
    results = await search_sessions(q.strip(), project, limit)
    return {"items": results, "total": len(results)}


@router.get(
    "/sessions/{session_id}",
    summary="获取会话详情",
    description="返回完整的已合并消息列表。",
    response_model=SessionDetail,
)
async def get_session(
    session_id: str,
    project: str = Query(..., description="编码后的项目目录名"),
) -> SessionDetail:
    detail = await get_session_detail(session_id, project)
    if detail is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    return detail


@router.get(
    "/sessions/{session_id}/subagents",
    summary="获取子代理列表",
    description="返回该会话下所有子代理的摘要信息。",
    response_model=list[SubagentInfo],
)
async def list_subagents(
    session_id: str,
    project: str = Query(..., description="编码后的项目目录名"),
) -> list[SubagentInfo]:
    return await get_subagents(session_id, project)


@router.get(
    "/sessions/{session_id}/subagents/{agent_id}",
    summary="获取子代理对话",
    description="返回子代理的完整消息列表。",
)
async def get_subagent(
    session_id: str,
    agent_id: str,
    project: str = Query(..., description="编码后的项目目录名"),
) -> dict:
    messages = await get_subagent_messages(session_id, project, agent_id)
    if messages is None:
        raise HTTPException(status_code=404, detail="子代理不存在")
    return {"agent_id": agent_id, "messages": messages}


class UpdateSessionNameRequest(BaseModel):
    name: str


@router.patch(
    "/sessions/{session_id}/name",
    summary="更新会话名称",
    description="设置或更新会话的自定义名称。",
)
async def update_session_name(session_id: str, req: UpdateSessionNameRequest) -> dict:
    set_name(session_id, req.name.strip())
    return {"session_id": session_id, "name": req.name.strip()}
