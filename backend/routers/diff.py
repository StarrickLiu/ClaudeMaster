# Git diff API
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Query, HTTPException

router = APIRouter(tags=["差异"])


async def _run_git(project_path: str, *args: str) -> str:
    """在项目目录中执行 git 命令。"""
    proc = await asyncio.create_subprocess_exec(
        "git", *args,
        cwd=project_path,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0 and not stdout:
        raise HTTPException(
            status_code=400,
            detail=f"git 命令失败: {stderr.decode('utf-8', errors='replace')[:500]}",
        )
    return stdout.decode("utf-8", errors="replace")


@router.get(
    "/diff",
    summary="获取项目的 git diff",
    description="对指定项目目录执行 git diff HEAD，返回 unified diff 和统计信息。",
)
async def get_diff(
    project_path: str = Query(..., description="项目绝对路径"),
) -> dict:
    diff_text = await _run_git(project_path, "diff", "HEAD")
    stat_text = await _run_git(project_path, "diff", "HEAD", "--stat")
    return {"diff": diff_text, "stat": stat_text}
