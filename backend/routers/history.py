# 历史记录 API
from fastapi import APIRouter, Query

from services.history_reader import read_history

router = APIRouter(tags=["历史"])


@router.get(
    "/history",
    summary="获取全局历史",
    description="从 ~/.claude/history.jsonl 读取历史条目，支持搜索和分页。",
)
async def list_history(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    search: str | None = Query(None, description="搜索关键词"),
) -> dict:
    items, total = await read_history(limit, offset, search)
    return {"items": items, "total": total}
