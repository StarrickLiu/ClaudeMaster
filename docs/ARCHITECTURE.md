# ClaudeMaster — Claude Code Web 管理平台

## 1. 项目概述

### 1.1 ClaudeMaster 是什么

ClaudeMaster 是一个个人使用的 Web 管理平台，用于管理本机上运行的 Claude Code（Anthropic 出品的命令行 AI 编程工具）。它可以：

- 浏览和管理本机上所有运行中的 Claude Code 进程
- 在 Web 界面中查看所有项目的对话历史
- 从任意设备（手机、平板、电脑）通过浏览器访问
- 实时监控活跃会话的对话输出
- 从浏览器中启动、停止、恢复 Claude Code 会话

### 1.2 产品定位

本平台的核心价值是让开发者**监督、审查和指挥**多个 Claude Code AI 编程代理。完整的产品设计见 [PRODUCT.md](./PRODUCT.md)。

### 1.3 代码架构原则

代码层面遵循以下原则，使人与 AI 能高效协作开发此项目：

- **清晰优于精巧**：每个文件职责单一，数据流显式，无框架魔法
- **模块隔离**：每个模块可独立理解、修改和测试，改动极少波及其他模块
- **类型化接口**：Python 用 Pydantic + 类型标注，TypeScript 用严格模式 + 接口
- **约定优于配置**：Python `snake_case`、TypeScript `camelCase`，文件位置可预测
- **上下文自包含**：每个源文件开头注释说明用途，API 端点自带文档

---

## 2. Claude Code 数据模型分析

理解 Claude Code 的内部数据结构是本平台的基础。

### 2.1 文件系统布局

```
~/.claude.json                              # 主配置：账户、项目设置、功能开关
~/.claude/
  .credentials.json                         # OAuth 凭证（权限 600，绝不暴露）
  settings.json                             # 用户级设置
  history.jsonl                             # 全局消息索引（每条用户消息一个条目）
  stats-cache.json                          # 使用统计（token 数、会话数、模型用量）

  projects/
    <项目路径用短横线连接>/                    # 例如 -home-user-codes-MyProject
      <会话UUID>.jsonl                       # 完整对话记录
      <会话UUID>/
        subagents/
          agent-<短ID>.jsonl                 # 子代理的对话记录

  debug/
    <会话UUID>.txt                           # 每个会话的调试日志
    latest -> <当前会话>.txt                  # 指向活跃会话日志的符号链接

  file-history/
    <会话UUID>/
      <文件哈希>@v1, @v2, ...               # 文件版本快照（撤销历史）

  tasks/
    <会话UUID>/
      .lock, .highwatermark                 # 任务进度追踪

  todos/
    <会话UUID>-agent-<id>.json              # 待办事项状态

  plans/
    <自动生成的名称>.md                       # 保存的计划

/tmp/claude/                                # 缓存中断用的提示词差异
/tmp/claude-<uid>/                          # 运行时任务符号链接
```

### 2.2 对话 JSONL 格式

会话 `.jsonl` 文件中的每一行是一个 JSON 对象：

```jsonc
{
  "type": "user" | "assistant",
  "uuid": "消息UUID",
  "parentUuid": "父消息UUID",               // 形成树结构，支持对话分支
  "sessionId": "会话UUID",
  "version": "2.1.42",                      // Claude Code 版本号
  "gitBranch": "main",
  "cwd": "/home/user/codes/MyProject",
  "timestamp": "2025-02-17T10:30:00.000Z",
  "message": {
    "role": "user" | "assistant",
    "content": [                             // 内容块数组
      { "type": "text", "text": "..." },
      { "type": "tool_use", "id": "...", "name": "Read", "input": {...} },
      { "type": "tool_result", "tool_use_id": "...", "content": "..." },
      { "type": "thinking", "thinking": "..." }
    ]
  },
  "toolUseResult": {                         // 工具执行输出
    "stdout": "...",
    "stderr": "..."
  },
  "requestId": "req-...",                    // API 请求 ID（仅 assistant 消息）
  "thinkingMetadata": { ... }                // 思维模式配置
}
```

### 2.3 全局历史格式（`history.jsonl`）

```jsonc
{
  "display": "用户消息摘要文本",
  "projectPath": "/home/user/codes/MyProject",
  "sessionId": "会话UUID",
  "timestamp": "2025-02-17T10:30:00.000Z"
}
```

### 2.4 进程检测

Claude Code 以 Node.js 进程运行。检测方法：
- 扫描 `/proc/*/cmdline`，查找包含 `claude-code/cli.js` 的进程
- 或使用 `pgrep -af claude` 查找运行中的实例
- 每个进程关联一个 PTY（`/dev/pts/N`）
- Claude Code 进程内设置了环境变量 `CLAUDECODE=1`

---

## 3. 系统架构

```
┌──────────────────────────────────────────────────────────┐
│                     浏览器（任意设备）                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │
│  │  仪表盘   │  │ 会话浏览  │  │ 对话查看  │  │ 进程控制 │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬────┘ │
│       └──────────────┴─────────────┴─────────────┘      │
│                          │                               │
│              HTTP REST + WebSocket                        │
└──────────────────────────┬───────────────────────────────┘
                           │
┌──────────────────────────┴───────────────────────────────┐
│                  ClaudeMaster 后端                        │
│                  (Python FastAPI)                         │
│                                                          │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐ │
│  │    路由层    │  │    服务层     │  │     模型层      │ │
│  │             │  │              │  │                 │ │
│  │ /sessions   │  │ SessionStore │  │ Session         │ │
│  │ /processes  │  │ ProcessMgr   │  │ Message         │ │
│  │ /history    │  │ HistoryReader│  │ Process         │ │
│  │ /ws         │  │ FileWatcher  │  │ Project         │ │
│  └─────────────┘  └──────────────┘  └─────────────────┘ │
│                          │                               │
│                  文件系统 + 进程表                         │
└──────────────────────────┬───────────────────────────────┘
                           │
┌──────────────────────────┴───────────────────────────────┐
│                       宿主机                              │
│                                                          │
│  ~/.claude/projects/.../*.jsonl    （对话数据）            │
│  ~/.claude/history.jsonl           （全局历史）            │
│  ~/.claude.json                    （配置与状态）          │
│  /proc/*/cmdline                   （进程检测）            │
│  claude CLI                        （进程控制）            │
└──────────────────────────────────────────────────────────┘
```

### 3.1 后端：Python + FastAPI

**为什么选择 Python + FastAPI：**
- 原生异步——WebSocket 和文件监听所必需
- Pydantic 数据校验——干净、有类型的数据模型
- 样板代码极少——一个路由文件约 30 行
- 非常适合 AI 辅助开发——Python 是 AI 模型理解得最好的语言
- 一条 `pip install` 即可搭建——无复杂构建链

**为什么不选 Node.js：**
- 虽然 Claude Code 本身是 Node.js，但我们的后端是独立关注点
- Python 在文件监听、进程管理、数据解析方面的生态更成熟
- Python 对 AI 来说更容易正确维护（无回调地狱，async/await 清晰）

### 3.2 前端：TypeScript + Vite + Lit（Web Components）

**为什么选择 Lit Web Components：**
- 零框架锁定——标准 Web Components API
- 运行时极小（约 5KB），对比 React（约 40KB）——手机加载更快
- 每个组件是独立文件——非常适合 AI 独立修改
- 无 JSX 转译复杂度——使用模板字面量
- 浏览器原生标准——多年后依然可用，不会被框架迭代淘汰

**为什么不选 React/Vue/Svelte：**
- 这是个人工具，不是团队项目——框架开销不值得
- 对 AI 协作来说心智模型更简单——无虚拟 DOM，无隐式响应式
- 迭代更快：改一个 `.ts` 文件，Vite HMR 立刻生效

### 3.3 通信方式：REST + WebSocket

| 场景 | 协议 | 原因 |
|------|------|------|
| 会话列表、历史 | REST GET | 静态数据，可缓存 |
| 对话内容 | REST GET | 加载一次，内容不变 |
| 实时对话流 | WebSocket | 实时性，服务器推送 |
| 进程控制（启动/停止） | REST POST | 一次性操作 |
| 进程状态更新 | WebSocket | 实时状态变化 |

---

## 4. 功能规格

### 4.1 仪表盘（首页）

**目的**：一目了然地查看所有 Claude Code 活动。

**内容**：
- **活跃进程**：卡片展示每个运行中的 Claude Code 实例
  - 项目名、会话 ID（缩写）、PID、运行时长
  - 当前 Git 分支
  - 最近一条消息预览
  - 状态指示器（活跃/空闲）
- **最近会话**：按时间排列的最近对话
  - 项目名、开始时间、消息数量
  - 第一条用户消息作为预览
- **快速统计**：总会话数、总 token 用量、项目数量

### 4.2 会话浏览器

**目的**：跨项目浏览所有对话会话。

**内容**：
- **筛选栏**：按项目、日期范围、搜索文本筛选
- **会话列表**：按时间倒序排列
  - 项目标签、会话时间、消息数量
  - 第一条用户消息预览
  - 会话时的 Git 分支
- **分组视图**：支持按项目分组

### 4.3 对话查看器

**目的**：以良好排版阅读完整对话。

**内容**：
- **消息列表**：用户/助手消息交替显示
  - 用户消息：纯文本，支持 Markdown 渲染
  - 助手消息：Markdown 渲染，代码块语法高亮
  - 工具调用：可折叠面板，显示工具名、输入、输出
  - 思维块：可折叠，淡色样式
- **消息树**：对话分支时显示可视化指示（基于 parentUuid）
- **元数据侧栏**：会话信息、token 用量、工具调用次数
- **导航**：跳转到特定消息、会话内搜索
- **子代理查看**：内嵌展开子代理的对话

### 4.4 进程控制面板

**目的**：管理运行中的 Claude Code 实例。

**内容**：
- **启动新会话**：选择项目目录，可选初始提示词
- **恢复会话**：从最近会话列表中选择，使用 `claude -r <id>` 恢复
- **停止进程**：向运行中的实例发送 SIGTERM（需确认）
- **实时终端**：（第二阶段）内嵌终端视图，显示实时输出

### 4.5 移动端优化

- 响应式布局：手机单列，桌面多列
- 触控友好：大点击区域，滑动导航
- 对话查看器：消息全宽显示，工具调用默认折叠
- 手机端底部导航栏（仪表盘 / 会话 / 活跃进程）

---

## 5. 项目结构

```
ClaudeMaster/
├── backend/
│   ├── main.py                    # FastAPI 应用入口、CORS、生命周期
│   ├── config.py                  # 全局配置（路径、端口、版本号、认证）
│   ├── conftest.py                # pytest 共享 fixtures
│   ├── routers/
│   │   ├── sessions.py            # 会话 CRUD + 搜索 + 名称更新
│   │   ├── chat.py                # 交互式会话 API（启动/列表/更新/停止）
│   │   ├── processes.py           # 进程检测
│   │   ├── history.py             # 全局历史
│   │   ├── projects.py            # 项目列表
│   │   ├── diff.py                # Git diff 和提交历史
│   │   ├── usage.py               # Token 用量统计 + 图表
│   │   ├── agents.py              # 远程 agent 管理（列表/进程/会话/改名）
│   │   └── *_test.py              # 对应路由的测试
│   ├── services/
│   │   ├── base_session.py        # 会话基类（BaseSession）+ EventCallback 类型
│   │   ├── session_store.py       # 解析并缓存会话 JSONL 文件
│   │   ├── claude_broker.py       # Claude CLI 子进程管理（ClaudeSession + ClaudeBroker）
│   │   ├── client_hub.py          # 远程 agent 会话管理（RemoteSession + AgentConnection + ClientHub）
│   │   ├── session_registry.py    # 统一会话索引（合并 broker + hub）
│   │   ├── session_name_store.py  # 会话名称持久化（JSON 文件）
│   │   ├── name_generator.py      # Docker 风格随机名称生成器
│   │   ├── process_manager.py     # 检测运行中的 Claude 进程
│   │   ├── usage_service.py       # Token 用量聚合与缓存
│   │   ├── agent_config.py        # Agent 配置持久化（display_name 等）
│   │   ├── history_reader.py      # 解析全局 history.jsonl
│   │   ├── project_scanner.py     # 从 ~/.claude/projects/ 发现项目
│   │   └── *_test.py              # 对应服务的测试
│   ├── models/
│   │   ├── message.py             # ContentBlock, TokenUsage, Message
│   │   ├── session.py             # SessionSummary, SessionDetail, SubagentInfo
│   │   ├── process.py             # ClaudeProcess
│   │   ├── project.py             # Project
│   │   ├── chat.py                # StartChatRequest, ChatSessionInfo, UpdateChatRequest
│   │   ├── diff.py                # CommitInfo
│   │   └── agent.py               # KillProcessesRequest, UpdateAgentRequest
│   ├── ws/
│   │   ├── handler.py             # WebSocket 聊天桥梁
│   │   └── agent_handler.py       # Agent WebSocket 端点（cm-agent 通信）
│   └── requirements.txt
│
├── agent/
│   ├── cm_agent.py                # cm-agent 守护进程（远程机器上运行）
│   └── requirements.txt           # agent 依赖（websockets>=14.0）
│
├── frontend/
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── eslint.config.mjs          # ESLint flat config（typescript-eslint）
│   └── src/
│       ├── main.ts                # 应用启动、路由初始化、主题初始化
│       ├── router.ts              # Hash 路由（#/dashboard, #/viewer/...）
│       ├── api.ts                 # 后端 API 客户端（统一 _fetch 基方法）
│       ├── pages/
│       │   ├── dashboard.ts       # 仪表盘：活跃/待命/最近会话
│       │   ├── sessions.ts        # 会话浏览器：筛选 + 搜索 + 分页
│       │   ├── viewer.ts          # 对话查看器 + 交互式聊天
│       │   ├── agents.ts          # 远程机器管理页面
│       │   ├── settings.ts        # 设置页面：主题 + 认证令牌
│       │   └── docs.ts            # 文档页面
│       ├── components/
│       │   ├── chat-input.ts      # 聊天输入框 + 状态指示器
│       │   ├── session-header.ts  # 会话头部：改名、接入/恢复/断开
│       │   ├── session-card.ts    # 会话摘要卡片
│       │   ├── session-summary.ts # 会话统计摘要
│       │   ├── message-bubble.ts  # 对话消息气泡（Markdown 渲染）
│       │   ├── tool-call.ts       # 工具调用折叠面板（含 Todo 专属渲染）
│       │   ├── thinking-block.ts  # 思维块显示
│       │   ├── diff-view.ts       # 统一差异视图
│       │   ├── process-card.ts    # 进程信息卡片
│       │   ├── usage-card.ts      # 用量仪表卡片（柱状图 + 配额）
│       │   ├── nav-bar.ts         # 顶部导航栏
│       │   ├── permission-dialog.ts  # 工具权限审批对话框
│       │   ├── new-session-dialog.ts # 新建会话对话框
│       │   ├── launch-config-dialog.ts # 启动配置对话框
│       │   └── *.test.ts          # 对应组件的测试
│       ├── services/
│       │   └── chat-client.ts     # WebSocket 聊天客户端（状态机 + 心跳）
│       ├── styles/
│       │   ├── reset.css          # CSS 重置
│       │   ├── tokens.css         # 设计变量（颜色、间距、字体）
│       │   ├── layout.css         # 响应式网格、容器
│       │   └── shared.ts          # 共享 Lit CSS（对话框、按钮、动画）
│       └── utils/
│           ├── constants.ts       # 共享常量（MODEL_OPTIONS, PERMISSION_MODES, TOOL_PRESETS）
│           ├── format.ts          # 格式化工具（formatTokens, formatUptime, toolDescription）
│           ├── theme.ts           # 主题管理（getTheme, applyTheme）
│           ├── markdown.ts        # Markdown → HTML 渲染
│           ├── time.ts            # 日期时间格式化
│           └── time.test.ts       # time.ts 测试
│
├── docs/
│   ├── ARCHITECTURE.md            # 本文件
│   └── PRODUCT.md                 # 产品设计文档
│
├── ruff.toml                      # Python 代码检查配置（ruff）
├── Caddyfile                      # HTTPS 反向代理配置
├── start.sh                       # 一键启动脚本（构建 + 运行）
├── Makefile                       # 常用命令：make dev, make test, make https
├── CLAUDE.md                      # AI 助手工作指南
└── .gitignore
```

---

## 6. API 设计

### 6.1 REST 端点

```
GET  /api/projects
     → [{ path, name, sessionCount, lastActivity }]

GET  /api/sessions?project=<path>&limit=50&offset=0&search=<text>
     → { items: [SessionSummary], total: number }

GET  /api/sessions/:sessionId
     → { session: Session, messages: [Message] }

GET  /api/sessions/:sessionId/subagents
     → [{ agentId, messages: [Message] }]

GET  /api/history?limit=100&offset=0
     → { items: [HistoryEntry], total: number }

GET  /api/processes
     → [{ pid, sessionId, project, uptime, status }]

POST /api/processes/start
     body: { projectPath, prompt?, resumeSessionId? }
     → { pid, sessionId }

POST /api/processes/:pid/stop
     → { success: boolean }

POST /api/chat/start
     body: { project_path, resume_session_id?, model?, allowed_tools?, ... }
     → ChatSessionInfo { session_id, claude_session_id?, name, state, launch_config, ... }

GET  /api/chat/sessions
     → [ChatSessionInfo]

PATCH /api/chat/:sessionId
     body: { name? }
     → ChatSessionInfo

POST /api/chat/:sessionId/stop
     → { success: boolean }

GET  /api/usage
     → UsageResponse { today, window_5h, daily }

GET  /api/usage/chart?days=7|14|30
     → [DailyUsage]

GET  /api/quota
     → QuotaResponse { five_hour, seven_day, ... }

GET  /api/agents
     → [AgentInfo { agent_id, hostname, display_name, state, mode, ... }]

GET  /api/agents/:agentId/processes
     → [RemoteProcess]

GET  /api/agents/:agentId/sessions
     → [SessionSummary]

GET  /api/agents/:agentId/sessions/:sessionId
     → SessionDetail

POST /api/agents/:agentId/kill-processes
     body: { pids: [int] }
     → { killed: [int], failed: [int] }

PATCH /api/agents/:agentId
     body: { display_name? }
     → { agent_id, display_name }
```

#### 会话 ID 说明

Broker 管理的会话有两个 ID：

| ID | 说明 | 用途 |
|----|------|------|
| `session_id`（initial_id） | 新建时为随机 UUID，恢复时为原 session_id | 前端 URL、WebSocket 连接、broker 查找 |
| `claude_session_id` | Claude Code 进程分配的真实 ID | JSONL 文件名、历史数据加载 |

`list_sessions` 和 `start_chat` 同时返回两个 ID。当两者相同时 `claude_session_id` 为 null。

### 6.2 WebSocket 协议（交互式聊天）

```
连接地址：ws://host:port/ws/chat/{session_id}?token=<auth_token>

── 服务端 → 客户端 ──

// 初始状态（连接后立即发送）
{ "type": "_state", "session_id": "real-claude-id", "state": "idle" }

// Claude stdout 事件（透传 stream-json 协议）
{ "type": "system", "subtype": "init", "session_id": "..." }
{ "type": "stream_event", "event": { "type": "content_block_delta", ... } }
{ "type": "result", "stats": { "input_tokens": N, "output_tokens": N, "cost_usd": N } }

// 工具权限请求
{ "type": "control_request", "request_id": "...", "request": {
    "type": "can_use_tool", "tool_name": "Bash", "input": { "command": "..." }
  }
}

// 进程关闭
{ "type": "_internal", "subtype": "closed" }

── 客户端 → 服务端 ──

// 发送用户消息
{ "type": "user_message", "text": "..." }

// 回复工具权限
{ "type": "control_response", "request_id": "...", "behavior": "allow"|"deny",
  "updated_input": {...}, "message": "..." }

// 中断执行
{ "type": "interrupt" }
```

### 6.3 Agent WebSocket 协议

```
连接地址：ws://host:port/ws/agent/{client_id}?token=<auth_token>

── Agent → 服务端 ──
// 注册（首条消息）
{ "type": "register", "hostname": "...", "mode": "daemon"|"oneshot", "allowed_paths": [...] }

// 事件转发
{ "type": "event", "session_id": "...", "event": { ... } }

// 状态报告
{ "type": "agent_status", "session_id": "...", "status": "claude_exited", "exit_code": 0 }

// 进程上报
{ "type": "processes", "items": [...], "sessions": [...] }

// 会话启动结果
{ "type": "session_started"|"session_start_failed", "request_id": "...", "session_id": "..." }

── 服务端 → Agent ──
// 注册确认
{ "type": "registered", "agent_id": "...", "mode": "daemon" }

// 启动会话
{ "type": "start_session", "request_id": "...", "project_path": "...", "claude_args": [...] }

// 停止会话
{ "type": "stop_session", "session_id": "..." }

// 心跳
{ "type": "ping", "ts": 1234567890 }
```

#### Broker 架构

ClaudeBroker 是一个单例，管理所有 Claude CLI 子进程：

- 启动子进程时使用 `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages`
- 通过 stdin 写入 JSON 消息，从 stdout 读取 JSON 事件
- 每个 ClaudeSession 维护订阅者列表，WebSocket handler 订阅事件并转发给浏览器
- 同一个 session 对象通过 `initial_id` 和 `session_id` 两个 key 在 `_sessions` 字典中索引

---

## 7. 关键实现细节

### 7.1 会话解析策略

会话 JSONL 文件可能很大（数千条消息）。策略：

1. **懒加载**：首次请求时解析 JSONL 文件并缓存结果
2. **增量更新**：使用 `inotify`（通过 `watchdog` 库）检测文件追加
3. **摘要缓存**：在内存中保存会话摘要（消息数、首条消息、时间戳）
4. **分页加载**：对话查看器按每页 50 条消息分页

### 7.2 进程检测

```python
# 扫描 /proc 查找 Claude Code 进程
for pid_dir in Path("/proc").iterdir():
    if not pid_dir.name.isdigit():
        continue
    cmdline = (pid_dir / "cmdline").read_text()
    if "claude-code/cli.js" in cmdline:
        # 从 /proc/<pid>/environ 提取会话信息
        # 读取 CLAUDECODE 环境变量、工作目录等
        yield ClaudeProcess(pid=int(pid_dir.name), ...)
```

### 7.3 实时对话监听

```python
# 使用 watchdog 监控 ~/.claude/projects/ 下的 JSONL 变更
class SessionFileHandler(FileSystemEventHandler):
    def on_modified(self, event):
        if event.src_path.endswith(".jsonl"):
            # 读取文件新追加的行
            new_messages = read_new_lines(event.src_path)
            # 推送给 WebSocket 订阅者
            await ws_manager.broadcast(session_id, new_messages)
```

### 7.4 会话命名

会话名称存储在 `~/.claude/cm_session_names.json`，格式为 `{session_id: name}`。

- **自动命名**：每个会话自动分配 Docker 风格名称（如 `swift-fox`、`calm-oak`）
- **持久化**：`session_name_store.py` 提供 `get_name / set_name / ensure_name` 接口
- **Broker 命名**：活跃会话（Broker 管理的子进程）有独立的名称生成（`name_generator.py`）
- **双写**：在 viewer 中重命名时，同时更新 Broker 会话和 name store

### 7.5 安全考虑

- **默认绑定 localhost** ——仅本机可访问
- **可选认证令牌** ——设置 `AUTH_TOKEN` 后绑定 `0.0.0.0`，HTTP 请求需 Bearer Token，WebSocket 需 query param token
- **HTTPS 支持** ——通过 Caddy 反向代理，`tls internal` 自签名证书
- **绝不暴露 `.credentials.json`** ——后端内部使用（如需要），绝不通过 API 返回
- **不转发凭证** ——Web 界面永远看不到 API 密钥

---

## 8. 开发路线图

### 第一阶段：只读查看器 ✅

- [x] 后端：会话 JSONL 解析器 + 摘要缓存
- [x] 后端：项目扫描器 + 历史记录阅读器
- [x] 后端：REST API（sessions/projects/history/diff/commits）
- [x] 前端：仪表盘（活跃进程 + 待命中 + 最近会话）
- [x] 前端：对话查看器（Markdown、代码块、工具调用折叠、思维块）
- [x] 移动端响应式布局

### 第二阶段：实时监控 ✅

- [x] 后端：/proc 进程检测
- [x] 后端：WebSocket 双向通信（Broker 架构）
- [x] 前端：活跃进程卡片 + 实时工具活动日志
- [x] 前端：流式文本 + 思维过程实时渲染
- [x] 桌面通知（权限请求、任务完成）

### 第三阶段：交互式会话 ✅

- [x] 后端：Broker 管理 Claude CLI 子进程（stream-json 协议）
- [x] 后端：启动/恢复/停止会话 API
- [x] 前端：聊天输入框 + 自动重连
- [x] 前端：工具权限审批对话框（允许/拒绝/始终允许）
- [x] 前端：启动配置对话框（模型、权限模式、预算、轮数）
- [x] 会话自动命名（Docker 风格）+ 内联重命名

### 第四阶段：增强功能（进行中）

- [x] 跨所有对话的全文搜索
- [x] Token 用量统计 + 配额显示
- [x] HTTPS 支持（Caddy 反向代理 + 自签名证书）
- [x] 24 小时待命中会话分区
- [x] 深色/浅色主题切换
- [ ] 导出对话（Markdown、HTML）
- [ ] 子代理对话树可视化

### 第五阶段：多机管理 ✅

- [x] cm-agent 守护进程（WebSocket 连接 + 心跳 + 断线重连）
- [x] 远程会话启动/停止/交互
- [x] 远程进程列表 + 批量终止
- [x] Agent 管理页面（在线状态、延迟、改名）
- [x] SessionRegistry 统一本地/远程会话路由

---

## 9. 快速启动

```bash
git clone https://github.com/StarrickLiu/ClaudeMaster.git
cd ClaudeMaster

# 方式一：一键启动（生产模式，自动构建前端）
./start.sh

# 方式二：开发模式（热重载）
make install   # 首次安装依赖
make dev       # 后端 :8420 + 前端 :5173
```

局域网 / 外网访问：
```bash
# HTTP 模式（局域网）
AUTH_TOKEN=my-secret-token ./start.sh

# HTTPS 模式（外网，需安装 Caddy）
AUTH_TOKEN=my-secret-token ./start.sh &
make https     # Caddy :443 → 后端 :8420
```
