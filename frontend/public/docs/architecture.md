# 技术架构

## 数据来源

| 数据 | 来源 | 获取方式 |
|------|------|---------|
| 会话列表与内容 | `~/.claude/projects/**/*.jsonl` | 解析 JSONL，内存缓存 |
| 全局历史 | `~/.claude/history.jsonl` | 逐行解析 |
| 本地进程 | `/proc/*/cmdline` | 扫描含 `claude-code/cli.js` 的进程 |
| 远程进程 | cm-agent 上报 | WebSocket 定期推送 |
| Broker 会话（本地） | 内存 `ClaudeBroker` 单例 | 子进程 stdin/stdout JSON 流通信 |
| Broker 会话（远程） | 内存 `ClientHub` | cm-agent WebSocket 转发 |
| 用量统计 | JSONL 文件 usage 字段 | 聚合 token 计数 + 定价计算 |
| Git 信息 | 项目目录 `.git/` | `git diff`, `git log --stat` |

## 后端（Python + FastAPI）

```
backend/
├── main.py                    # 入口：CORS、认证中间件、路由挂载
├── config.py                  # 全局配置（路径、端口、版本号、认证）
├── routers/                   # REST API 路由
│   ├── sessions.py            # 会话 CRUD + 搜索
│   ├── processes.py           # 进程检测
│   ├── chat.py                # 交互会话管理（启动/停止/列表）
│   ├── diff.py                # Git diff + 提交历史
│   ├── usage.py               # Token 用量统计 + 图表
│   ├── agents.py              # 远程 agent 管理（列表/进程/会话/改名）
│   └── ...
├── services/                  # 业务逻辑
│   ├── base_session.py        # 会话基类（BaseSession）
│   ├── claude_broker.py       # 本地子进程管理（ClaudeSession + ClaudeBroker）
│   ├── client_hub.py          # 远程 agent 管理（RemoteSession + ClientHub）
│   ├── session_registry.py    # 统一会话索引（合并本地 + 远程）
│   ├── session_store.py       # JSONL 解析与缓存
│   ├── usage_service.py       # Token 用量聚合与缓存
│   ├── name_generator.py      # Docker 风格随机名称
│   ├── agent_config.py        # Agent 配置持久化
│   └── ...
├── models/                    # Pydantic 数据模型
│   ├── session.py             # SessionSummary, SessionDetail
│   ├── message.py             # ContentBlock, Message
│   ├── chat.py                # StartChatRequest, ChatSessionInfo
│   ├── agent.py               # KillProcessesRequest, UpdateAgentRequest
│   ├── diff.py                # CommitInfo
│   └── ...
└── ws/                        # WebSocket 处理
    ├── handler.py             # 聊天桥梁（浏览器 ↔ Broker）
    └── agent_handler.py       # Agent 通道（cm-agent ↔ ClientHub）
```

## 前端（TypeScript + Lit + Vite）

```
frontend/src/
├── main.ts                    # 路由注册、应用启动、主题初始化
├── api.ts                     # REST API 客户端（统一 _fetch 基方法）
├── pages/                     # 页面级组件
│   ├── dashboard.ts           # 工作台
│   ├── sessions.ts            # 会话历史
│   ├── viewer.ts              # 对话查看器 + 实时聊天
│   ├── agents.ts              # 远程机器管理
│   ├── settings.ts            # 设置（主题 + 令牌）
│   └── docs.ts                # 产品文档
├── components/                # 可复用 UI 组件
│   ├── session-card.ts        # 会话摘要卡片
│   ├── process-card.ts        # 进程卡片
│   ├── message-bubble.ts      # 消息气泡
│   ├── tool-call.ts           # 工具调用展示
│   ├── usage-card.ts          # 用量仪表卡片
│   ├── new-session-dialog.ts  # 新建会话对话框
│   ├── launch-config-dialog.ts# 启动配置对话框
│   ├── permission-dialog.ts   # 权限审批对话框
│   ├── nav-bar.ts             # 导航栏
│   └── ...
├── services/                  # WebSocket 客户端
│   └── chat-client.ts         # 状态机 + 心跳检测
├── styles/                    # CSS 设计变量 + 共享 Lit CSS
│   └── shared.ts              # 对话框、按钮、动画样式
└── utils/                     # 工具函数
    ├── constants.ts            # 模型/权限/工具预设常量
    ├── format.ts               # formatTokens, formatUptime, toolDescription
    ├── theme.ts                # 暗色/亮色主题管理
    ├── markdown.ts             # Markdown 渲染
    └── time.ts                 # 日期时间格式化
```

## 通信协议

| 场景 | 协议 | 说明 |
|------|------|------|
| 历史数据查询 | REST GET | 会话列表、对话内容、进程列表、用量统计 |
| 操作 | REST POST/PATCH | 启动/停止会话、终止进程、更新配置 |
| 实时交互 | WebSocket `/ws/chat/{id}` | 对话流、状态推送、权限请求 |
| Agent 通信 | WebSocket `/ws/agent/{id}` | cm-agent 注册、事件转发、进程上报 |

## 会话架构

### BaseSession 基类

`ClaudeSession` 和 `RemoteSession` 共享基类 `BaseSession`，提供统一的 `subscribe/unsubscribe/_notify` 事件订阅接口。

### 本地会话（ClaudeBroker）

`ClaudeBroker` 管理本地 Claude Code 子进程：

- **双 key 索引**：`_sessions` 字典同时用 `initial_id`（稳定 UUID）和 `session_id`（Claude 真实 ID）做 key
- **stdin/stdout 通信**：通过 JSON 行协议与 Claude Code 双向通信
- **自动权限批准**：`bypassPermissions` 模式下自动回复 `control_request`
- **事件订阅**：WebSocket handler 订阅事件，实时转发给前端

### 远程会话（ClientHub）

`ClientHub` 管理远程 cm-agent 连接和会话：

- **AgentConnection**：一个 cm-agent 守护进程的 WebSocket 连接，可管理多个会话
- **RemoteSession**：远程机器上的 Claude Code 会话，接口与 ClaudeSession 一致
- **断线重连**：agent 断线后 300 秒内保留会话，重连时自动恢复
- **心跳检测**：每 30 秒 ping/pong，前端监测 10 秒超时

### SessionRegistry

统一索引层，将 ClaudeBroker（本地）和 ClientHub（远程）合并，路由操作（发送消息、权限回复、停止等）到正确的后端。

## API 概览

| 端点 | 说明 |
|------|------|
| `GET /api/sessions` | 会话列表（分页、搜索） |
| `GET /api/processes` | 本地进程列表 |
| `POST /api/chat/start` | 启动会话（本地或远程） |
| `GET /api/chat/sessions` | 活跃会话列表 |
| `GET /api/usage` | Token 用量统计 |
| `GET /api/agents` | 所有 agent 列表 |
| `GET /api/agents/:id/processes` | 远程进程列表 |
| `POST /api/agents/:id/kill-processes` | 终止远程进程 |
| `GET /api/commits` | Git 提交历史 |
