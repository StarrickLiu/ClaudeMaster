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
    <项目路径用短横线连接>/                    # 例如 -home-star-codes-MyProject
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
  "cwd": "/home/star/codes/MyProject",
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
  "projectPath": "/home/star/codes/MyProject",
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
│   ├── config.py                  # 所有配置（路径、端口等）
│   ├── routers/
│   │   ├── __init__.py
│   │   ├── sessions.py            # GET /api/sessions, GET /api/sessions/:id
│   │   ├── processes.py           # GET/POST /api/processes
│   │   ├── history.py             # GET /api/history
│   │   └── projects.py            # GET /api/projects
│   ├── services/
│   │   ├── __init__.py
│   │   ├── session_store.py       # 解析并缓存会话 JSONL 文件
│   │   ├── process_manager.py     # 检测、启动、停止 Claude 进程
│   │   ├── history_reader.py      # 解析全局 history.jsonl
│   │   ├── project_scanner.py     # 从 ~/.claude/projects/ 发现项目
│   │   └── file_watcher.py        # 监听新增/变更的 JSONL 文件
│   ├── models/
│   │   ├── __init__.py
│   │   ├── session.py             # Session, SessionSummary
│   │   ├── message.py             # Message, ContentBlock, ToolCall
│   │   ├── process.py             # ClaudeProcess
│   │   └── project.py             # Project
│   ├── ws/
│   │   ├── __init__.py
│   │   └── handler.py             # WebSocket 连接管理器
│   ├── requirements.txt
│   └── pyproject.toml
│
├── frontend/
│   ├── index.html                 # SPA 入口
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── src/
│   │   ├── main.ts                # 应用启动、路由初始化
│   │   ├── router.ts              # 简单的 hash 路由
│   │   ├── api.ts                 # 后端 API 客户端（fetch 封装）
│   │   ├── ws.ts                  # WebSocket 客户端
│   │   ├── pages/
│   │   │   ├── dashboard.ts       # 仪表盘页面组件
│   │   │   ├── sessions.ts        # 会话浏览器页面
│   │   │   ├── viewer.ts          # 对话查看器页面
│   │   │   └── processes.ts       # 进程控制页面
│   │   ├── components/
│   │   │   ├── nav-bar.ts         # 顶部/底部导航
│   │   │   ├── session-card.ts    # 会话摘要卡片
│   │   │   ├── process-card.ts    # 运行中进程卡片
│   │   │   ├── message-bubble.ts  # 对话消息气泡
│   │   │   ├── tool-call.ts       # 工具调用折叠面板
│   │   │   ├── thinking-block.ts  # 思维块显示
│   │   │   ├── code-block.ts      # 语法高亮代码块
│   │   │   └── search-bar.ts      # 搜索/筛选组件
│   │   ├── styles/
│   │   │   ├── reset.css          # CSS 重置
│   │   │   ├── tokens.css         # 设计变量（颜色、间距、字体）
│   │   │   └── layout.css         # 响应式网格、容器
│   │   └── utils/
│   │       ├── markdown.ts        # Markdown → HTML 渲染
│   │       ├── time.ts            # 日期时间格式化
│   │       └── highlight.ts       # 代码语法高亮
│   └── public/
│       └── favicon.svg
│
├── docs/
│   └── ARCHITECTURE.md            # 本文件
│
├── scripts/
│   ├── dev.sh                     # 启动开发模式（后端 + 前端）
│   └── install.sh                 # 一键安装
│
├── .gitignore
├── CLAUDE.md                      # AI 助手工作指南
└── Makefile                       # 常用命令：make dev, make install
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
```

### 6.2 WebSocket 协议

```
连接地址：ws://host:port/ws

服务端 → 客户端消息：
{
  "type": "process_update",
  "data": { pid, sessionId, status, lastMessage? }
}
{
  "type": "new_message",
  "data": { sessionId, message: Message }
}
{
  "type": "session_created",
  "data": { sessionId, project }
}

客户端 → 服务端消息：
{
  "type": "subscribe",
  "sessionId": "..."          // 订阅某个会话的实时更新
}
{
  "type": "unsubscribe",
  "sessionId": "..."
}
```

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

### 7.4 安全考虑

- **默认绑定 localhost** ——仅本机可访问
- **可选认证令牌** ——局域网访问时需要 Bearer Token
- **绝不暴露 `.credentials.json`** ——后端内部使用（如需要），绝不通过 API 返回
- **默认只读** ——进程控制功能需要显式配置开启
- **不转发凭证** ——Web 界面永远看不到 API 密钥

---

## 8. 开发路线图

### 第一阶段：只读查看器（MVP）

**目标**：通过浏览器浏览和阅读所有 Claude Code 对话。

- [ ] 后端：会话 JSONL 解析器
- [ ] 后端：项目扫描器
- [ ] 后端：历史记录阅读器
- [ ] 后端：REST API（会话、项目、历史）
- [ ] 前端：仪表盘，展示最近会话
- [ ] 前端：会话浏览器，支持搜索和筛选
- [ ] 前端：对话查看器，支持 Markdown、代码块、工具调用
- [ ] 移动端响应式布局

**交付物**：`make dev` → 打开浏览器 → 浏览所有对话。

### 第二阶段：实时监控

**目标**：实时看到活跃对话的更新。

- [ ] 后端：进程检测
- [ ] 后端：JSONL 文件变更监听
- [ ] 后端：WebSocket 服务端
- [ ] 前端：活跃进程卡片，实时状态
- [ ] 前端：对话查看器中的实时消息流
- [ ] 新消息通知

### 第三阶段：进程控制

**目标**：从浏览器启动、停止和恢复 Claude Code 会话。

- [ ] 后端：启动进程（spawn `claude` 子进程）
- [ ] 后端：停止进程（SIGTERM）
- [ ] 后端：恢复会话（`claude -r <id>`）
- [ ] 前端：进程控制面板
- [ ] 前端：新建会话对话框（选择项目、可选提示词）

### 第四阶段：增强功能

**目标**：日常工作流的进阶功能。

- [ ] 跨所有对话的全文搜索
- [ ] Token 用量分析与费用追踪
- [ ] 会话收藏与标签
- [ ] 导出对话（Markdown、HTML、PDF）
- [ ] 深色/浅色主题切换
- [ ] 子代理对话树可视化

---

## 9. 快速启动（目标体验）

```bash
git clone <repo> ClaudeMaster
cd ClaudeMaster
make install   # pip install + npm install
make dev       # 启动后端 :8420，前端 :5173

# 在浏览器中打开 http://localhost:5173
```

手机局域网访问：
```bash
# 设置 AUTH_TOKEN 后，后端绑定 0.0.0.0
AUTH_TOKEN=my-secret-token make dev
# 手机浏览器打开 http://<主机IP>:5173，输入一次令牌即可
```
