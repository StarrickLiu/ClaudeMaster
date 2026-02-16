# 项目列表 API
from fastapi import APIRouter

from models.project import Project
from services.project_scanner import scan_projects

router = APIRouter(tags=["项目"])


@router.get(
    "/projects",
    summary="获取所有项目",
    description="扫描 ~/.claude/projects/ 返回所有已知项目及会话计数。",
    response_model=list[Project],
)
async def list_projects() -> list[Project]:
    return scan_projects()
