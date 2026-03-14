# 产品概述

> 本文档是 ClaudeMaster 的实时产品规范，随平台迭代持续更新。
> 开发新功能前请先阅读此文档，确保设计一致性。

## 什么是 ClaudeMaster

ClaudeMaster 是一个**个人使用的 Web 端 Claude Code CLI 管理平台**。它让开发者通过浏览器（手机、电脑均可）**监督、审查、指挥**本机上运行的多个 Claude Code AI 编程代理。

**核心价值**：一个界面管控所有 Claude Code 进程，随时随地掌握 AI 代理的工作状态。

## 核心能力

- 浏览和管理**本地和远程**运行中的 Claude Code 进程
- 在 Web 界面中查看所有项目的对话历史
- 从任意设备（手机、平板、电脑）通过浏览器访问
- 实时监控活跃会话的对话输出
- 从浏览器中启动、停止、恢复 Claude Code 会话
- 审批 Claude Code 的工具使用权限请求
- **多机管理**：通过 cm-agent 守护进程管理多台机器上的 Claude Code

## 核心概念

### 会话（Session）

一次 Claude Code 对话。数据存储在 `~/.claude/projects/<项目路径>/<会话ID>.jsonl` 中，每行一个 JSON 对象。

会话有以下属性：
- **session_id** — 唯一标识符
- **project_path** — 关联的项目目录
- **消息列表** — 用户消息、助手回复、工具调用、思维过程
- **统计数据** — 对话轮数、工具使用次数、token 用量

### 进程（Process）

宿主机上运行的 Claude Code CLI 进程。通过扫描 `/proc/*/cmdline` 检测。

进程分两类：
- **Broker 管理的进程** — 由 ClaudeMaster 启动，通过 broker 通信，状态精确可控
- **Legacy 进程** — 用户在终端手动启动的 Claude Code，ClaudeMaster 只能检测到它存在

### Broker

后端核心服务 `ClaudeBroker`，负责管理本地 Claude Code 子进程的生命周期。它通过 `--input-format stream-json --output-format stream-json` 与 Claude Code 进行 JSON 流通信。

### Agent（cm-agent）

部署在远程机器上的守护进程 `cm_agent.py`，通过 WebSocket 连接到 ClaudeMaster 后端。它可以：
- 上报远程机器上的 Claude Code 进程
- 代理启动/停止远程 Claude Code 会话
- 转发 Claude Code 的事件流到 ClaudeMaster

### SessionRegistry

统一会话索引层，将 ClaudeBroker（本地）和 ClientHub（远程 agent）合并，让上层代码无需关心会话在哪台机器上运行。
