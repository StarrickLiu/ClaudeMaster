# 进程检测 API
from fastapi import APIRouter

from models.process import ClaudeProcess
from services.process_manager import scan_claude_processes

router = APIRouter(tags=["进程"])


@router.get(
    "/processes",
    summary="获取运行中的 Claude Code 进程",
    description="扫描 /proc 返回所有活跃的 Claude Code 实例。",
    response_model=list[ClaudeProcess],
)
async def list_processes() -> list[ClaudeProcess]:
    return scan_claude_processes()
