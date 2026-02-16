# 检测运行中的 Claude Code 进程
from __future__ import annotations

import os
from pathlib import Path

from models.process import ClaudeProcess


def scan_claude_processes() -> list[ClaudeProcess]:
    """扫描 /proc 查找运行中的 Claude Code 进程。"""
    processes: list[ClaudeProcess] = []
    proc = Path("/proc")
    clk_tck = os.sysconf("SC_CLK_TCK")

    try:
        system_uptime = float(Path("/proc/uptime").read_text().split()[0])
    except (FileNotFoundError, ValueError):
        system_uptime = 0

    my_pid = os.getpid()

    for pid_dir in proc.iterdir():
        if not pid_dir.name.isdigit():
            continue

        pid = int(pid_dir.name)
        if pid == my_pid:
            continue

        try:
            cmdline_bytes = (pid_dir / "cmdline").read_bytes()
            cmdline = cmdline_bytes.replace(b"\x00", b" ").decode("utf-8", errors="replace").strip()
        except (PermissionError, FileNotFoundError, ProcessLookupError):
            continue

        if not cmdline:
            continue

        # 匹配 Claude Code 进程（排除浏览器扩展等）
        is_claude = "claude" in cmdline.lower() and (
            "cli.js" in cmdline
            or cmdline.split()[0].endswith("/claude")
            or cmdline.split()[0] == "claude"
        )
        if not is_claude:
            continue
        if "--chrome-native-host" in cmdline:
            continue

        # 获取工作目录
        try:
            cwd = str((pid_dir / "cwd").resolve())
        except (PermissionError, FileNotFoundError, OSError):
            cwd = ""

        # 计算进程运行时间
        uptime_seconds = 0.0
        try:
            stat_content = (pid_dir / "stat").read_text()
            # starttime 是 stat 文件中第 22 个字段（从 1 开始计数）
            # 需要跳过 comm 字段中可能的空格，所以先找到 ")" 再分割
            after_comm = stat_content.split(")")[1].split()
            start_ticks = int(after_comm[19])  # 第 22 个字段，索引 19（0-based，减去前两个字段）
            process_start = start_ticks / clk_tck
            uptime_seconds = max(0, system_uptime - process_start)
        except (IndexError, ValueError, FileNotFoundError, PermissionError):
            pass

        # 推断项目名
        project_name = Path(cwd).name if cwd else None

        processes.append(ClaudeProcess(
            pid=pid,
            cwd=cwd,
            uptime_seconds=round(uptime_seconds, 1),
            project_name=project_name,
        ))

    return processes
