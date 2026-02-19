# 技术架构

## 数据来源

| 数据 | 来源 | 获取方式 |
|------|------|---------|
| 会话列表与内容 | `~/.claude/projects/**/*.jsonl` | 解析 JSONL，内存缓存 |
| 全局历史 | `~/.claude/history.jsonl` | 逐行解析 |
| 运行中进程 | `/proc/*/cmdline` | 扫描含 `claude-code/cli.js` 的进程 |
| Broker 会话 | 内存 `ClaudeBroker` 单例 | 子进程 stdin/stdout JSON 流通信 |
| 用量统计 | `~/.claude/statsig/` + API 推算 | 解析 token 计数 |
| Git 信息 | 项目目录 `.git/` | `git diff`, `git log` |

## 后端（Python + FastAPI）

```
backend/
├── main.py              # 入口：CORS、认证中间件、路由挂载
├── config.py            # 配置：路径、Claude CLI 位置
├── routers/             # REST API 路由
│   ├── sessions.py      # 会话 CRUD
│   ├── processes.py     # 进程检测
│   ├── chat.py          # 交互会话管理（启动/停止/列表）
│   ├── diff.py          # Git diff
│   ├── usage.py         # 用量统计
│   └── ...
├── services/            # 业务逻辑
│   ├── session_store.py # JSONL 解析与缓存
│   ├── claude_broker.py # 子进程生命周期管理（核心）
│   └── ...
├── models/              # Pydantic 数据模型
└── ws/                  # WebSocket 处理
```

## 前端（TypeScript + Lit + Vite）

```
frontend/src/
├── main.ts              # 路由注册、应用启动
├── api.ts               # REST API 客户端
├── pages/               # 页面级组件
│   ├── dashboard.ts     # 工作台
│   ├── sessions.ts      # 会话历史
│   ├── viewer.ts        # 对话查看器
│   ├── settings.ts      # 设置
│   └── docs.ts          # 产品文档
├── components/          # 可复用 UI 组件
│   ├── session-card.ts  # 会话摘要卡片
│   ├── process-card.ts  # 进程卡片
│   ├── message-bubble.ts# 消息气泡
│   ├── tool-call.ts     # 工具调用展示
│   ├── nav-bar.ts       # 导航栏
│   └── ...
├── services/            # WebSocket 客户端等
├── styles/              # CSS 设计变量
└── utils/               # 工具函数
```

## 通信协议

| 场景 | 协议 | 说明 |
|------|------|------|
| 历史数据查询 | REST GET | 会话列表、对话内容、进程列表 |
| 操作 | REST POST | 启动/停止会话 |
| 实时交互 | WebSocket | 对话流、状态推送、权限请求 |

## Broker 架构

`ClaudeBroker` 是后端管理 Claude Code 子进程的核心单例：

- **双 key 索引**：`_sessions` 字典同时用 `initial_id`（稳定 UUID）和 `session_id`（Claude 真实 ID）做 key，两个 key 指向同一个 `ClaudeSession` 对象
- **项目去重**：同一 `project_path` 最多一个活跃会话（非 closed）
- **stdin/stdout 通信**：通过 JSON 行协议与 Claude Code 双向通信
- **事件订阅**：WebSocket handler 订阅 `ClaudeSession` 事件，实时转发给前端
