# Git diff / commits API
from __future__ import annotations

import asyncio
import re

from fastapi import APIRouter, Query, HTTPException
from pydantic import BaseModel

router = APIRouter(tags=["差异"])


async def _run_git(project_path: str, *args: str, allow_empty: bool = False) -> str:
    """在项目目录中执行 git 命令。"""
    proc = await asyncio.create_subprocess_exec(
        "git", *args,
        cwd=project_path,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0 and not stdout and not allow_empty:
        raise HTTPException(
            status_code=400,
            detail=f"git 命令失败: {stderr.decode('utf-8', errors='replace')[:500]}",
        )
    return stdout.decode("utf-8", errors="replace")


class CommitInfo(BaseModel):
    """单条提交摘要。"""
    hash: str
    short_hash: str
    subject: str
    author: str
    date: str          # ISO 8601
    stat: str          # --stat 输出
    insertions: int
    deletions: int
    files_changed: int


@router.get(
    "/diff",
    summary="获取项目的未提交 git diff",
    description="对指定项目目录执行 git diff HEAD，返回 unified diff 和统计信息。",
)
async def get_diff(
    project_path: str = Query(..., description="项目绝对路径"),
) -> dict:
    diff_text = await _run_git(project_path, "diff", "HEAD", allow_empty=True)
    stat_text = await _run_git(project_path, "diff", "HEAD", "--stat", allow_empty=True)
    return {"diff": diff_text, "stat": stat_text}


@router.get(
    "/commits",
    summary="获取最近提交列表",
    description="返回项目最近 N 条 git 提交的摘要信息（含 stat，不含完整 diff）。",
    response_model=list[CommitInfo],
)
async def get_commits(
    project_path: str = Query(..., description="项目绝对路径"),
    limit: int = Query(20, ge=1, le=100),
) -> list[CommitInfo]:
    # 格式：hash|subject|author|date（用特殊分隔符避免正文中的 | 干扰）
    SEP = "\x1f"
    log = await _run_git(
        project_path,
        "log",
        f"--format=%H{SEP}%s{SEP}%an{SEP}%aI",
        f"-{limit}",
        allow_empty=True,
    )
    commits: list[CommitInfo] = []
    for line in log.splitlines():
        parts = line.split(SEP)
        if len(parts) < 4:
            continue
        h, subject, author, date = parts[0], parts[1], parts[2], parts[3]
        stat = await _run_git(project_path, "show", h, "--stat", "--format=", allow_empty=True)
        # 解析最后一行 "N files changed, M insertions(+), K deletions(-)"
        ins = dels = files = 0
        m = re.search(r"(\d+) file", stat)
        if m:
            files = int(m.group(1))
        m = re.search(r"(\d+) insertion", stat)
        if m:
            ins = int(m.group(1))
        m = re.search(r"(\d+) deletion", stat)
        if m:
            dels = int(m.group(1))
        commits.append(CommitInfo(
            hash=h, short_hash=h[:7],
            subject=subject, author=author, date=date,
            stat=stat.strip(), insertions=ins, deletions=dels, files_changed=files,
        ))
    return commits


@router.get(
    "/commit",
    summary="获取单次提交的完整 diff",
    description="返回指定 commit hash 的 unified diff。",
)
async def get_commit_diff(
    project_path: str = Query(..., description="项目绝对路径"),
    hash: str = Query(..., description="commit hash"),
) -> dict:
    diff = await _run_git(project_path, "show", hash, "--format=", allow_empty=True)
    return {"diff": diff}
