# ClaudeMaster 产品文档

> 本文档是 ClaudeMaster 的实时产品规范，随平台迭代持续更新。
> 开发新功能前请先阅读此文档，确保设计一致性。

---

## 1. 产品定位

ClaudeMaster 是一个**个人使用的 Web 端 Claude Code CLI 管理平台**。它让开发者通过浏览器（手机、电脑均可）**监督、审查、指挥**本机上运行的多个 Claude Code AI 编程代理。

**核心价值**：一个界面管控所有 Claude Code 进程，随时随地掌握 AI 代理的工作状态。

---

## 2. 核心概念

### 2.1 会话（Session）

一次 Claude Code 对话。数据存储在 `~/.claude/projects/<项目路径>/<会话ID>.jsonl` 中，每行一个 JSON 对象。

会话有以下属性：
- **session_id** — 唯一标识符
- **project_path** — 关联的项目目录
- **消息列表** — 用户消息、助手回复、工具调用、思维过程
- **统计数据** — 对话轮数、工具使用次数、token 用量

### 2.2 进程（Process）

宿主机上运行的 Claude Code CLI 进程。通过扫描 `/proc/*/cmdline` 检测。

进程分两类：
- **Broker 管理的进程** — 由 ClaudeMaster 启动，通过 broker 通信，状态精确可控
- **Legacy 进程** — 用户在终端手动启动的 Claude Code，ClaudeMaster 只能检测到它存在

### 2.3 Broker

后端核心服务 `ClaudeBroker`，负责管理 Claude Code 子进程的生命周期。它通过 `--input-format stream-json --output-format stream-json` 与 Claude Code 进行 JSON 流通信。

同一项目允许多个并行会话，每个 Broker 会话自动分配 Docker 风格的随机名称（如 `swift-fox`、`bold-owl`），方便用户区分。用户也可在新建时指定自定义名称。

---

## 3. 工作台（Dashboard）

工作台是用户打开 ClaudeMaster 后看到的首页，一目了然地展示所有 Claude Code 活动。

### 3.1 区块划分规则

工作台分为以下区块，**按优先级从上到下排列**：

| 区块 | 状态点颜色 | 显示条件 | 包含内容 |
|------|-----------|---------|---------|
| **待审批** | 橙色闪烁 | 有会话等待工具权限审批 | Broker 会话中 `state=waiting_permission` 的 |
| **工作中** | 绿色闪烁 | 有 agent 正在执行命令 | Broker 会话中 `state=streaming` 或 `state=starting` 的 |
| **待命中** | 蓝色 | 有进程存活但空闲 | Broker `state=idle` 的会话 + Legacy 进程（终端手动启动的） |
| **最近会话** | 灰色 | 始终显示 | 所有 JSONL 历史会话（排除上述已展示的） |

### 3.2 状态流转

```
启动会话 → starting → idle（初始化完成）
                        ↓
发送消息 ──────→ streaming（agent 执行中）
                        ↓
执行完毕 ──────→ idle（等待下一条指令）
                        ↓
遇到需要审批的工具 → waiting_permission
                        ↓
用户审批/拒绝 ──→ streaming → idle
                        ↓
关闭会话 ──────→ closed
```

### 3.3 卡片类型

- **会话卡片（session-card）**：展示项目名、Git 分支、首条消息、最近助手回复、统计指标
- **进程卡片（process-card）**：展示 PID、运行时长、Git 分支（用于无 JSONL 匹配的 legacy 进程）
- **待审批卡片**：高亮显示等待审批的工具名称，点击进入会话审批
- **通用 fallback 卡片**：当 broker 会话无法匹配 JSONL 时的简易卡片

### 3.4 徽章规则

- **"运行中"** 徽章：仅在 **工作中** 区块的会话卡片上显示（`is_active: true`）
- **待命中** 区块的卡片不显示 "运行中"（即使进程在跑，但它是空闲的）
- **最近会话** 区块的卡片不显示 "运行中"（这些是历史记录）

---

## 4. 页面结构

### 4.1 工作台（#/dashboard）

首页。展示待审批、工作中、待命中、最近会话四个区块。支持新建会话。

### 4.2 会话历史（#/sessions）

跨项目浏览所有历史对话。支持：
- 按项目筛选
- 关键词搜索
- 分页浏览
- 新建会话

### 4.3 对话查看器（#/viewer/:project/:sessionId）

阅读完整对话内容。支持：
- Markdown 渲染（用户和助手消息）
- 工具调用折叠展示（名称、输入、输出）
- 思维过程折叠展示
- Diff 代码高亮
- 实时聊天（连接 broker 管理的会话时）
- 权限审批对话框

### 4.4 设置（#/settings）

- 深色/浅色主题切换
- 刷新间隔配置

### 4.5 产品文档（#/docs）

本文档。在平台内实时浏览，作为开发参考。

---

## 5. 交互式会话

### 5.1 新建会话

用户从工作台或会话历史页点击「+ 新建会话」：

1. 弹出配置对话框：选择项目目录、会话名称（可选）、模型、权限模式等
2. 后端 `POST /api/chat/start` 启动 Claude Code 子进程
3. 返回 `session_id` 后，前端跳转到对话查看器
4. 通过 WebSocket `/ws/chat/{session_id}` 建立实时通信

### 5.2 权限审批

当 Claude Code 请求使用需审批的工具时：
1. Broker 捕获 `control_request` 事件
2. 前端弹出权限对话框，显示工具名和输入参数
3. 用户可选择 Allow / Deny / 修改参数后 Allow
4. 响应通过 WebSocket 发回 broker，broker 写入 stdin

### 5.3 恢复会话

对于已有 JSONL 记录的会话，可通过 `resume_session_id` 恢复到 Claude Code 的历史上下文。

### 5.4 会话连接模式

打开对话查看器时**不会自动连接** broker 会话，避免与设置编辑冲突。用户可以：
- 点击「接入会话」按钮手动连接已有的 broker 会话
- 点击「恢复会话」按钮打开启动配置对话框，修改参数后重连
- 发送消息时若未连接会自动重连（用户主动操作触发）

**唯一例外**：从工作台「新建会话」跳转过来时自动接入（通过 `sessionStorage` 标记）。

### 5.5 会话名称编辑

在对话查看器的 session-header 中，点击会话名称可内联编辑。修改后通过 `PATCH /api/chat/{session_id}` 持久化到 broker。

### 5.6 启动配置可视化

session-header 下方始终显示当前会话的启动配置摘要（模型、权限模式、预算、轮数）。点击「恢复会话」时，配置对话框会预填充当前参数。

### 5.7 双 ID 体系

Broker 会话有两个 ID：
- **initial_id**（稳定标识）：新建时为随机 UUID，恢复时为 `resume_session_id`。前端 URL、WebSocket 连接、broker 内部查找均使用此 ID
- **claude_session_id**（真实 ID）：Claude Code 进程 init 后分配的真实 session_id，与 JSONL 文件名一致。用于加载历史对话数据

后端 `ChatSessionInfo` 同时返回两个 ID。前端 viewer 根据情况选择正确的 ID 查询 JSONL。

---

## 6. 数据来源

| 数据 | 来源 | 获取方式 |
|------|------|---------|
| 会话列表与内容 | `~/.claude/projects/**/*.jsonl` | 解析 JSONL，内存缓存 |
| 全局历史 | `~/.claude/history.jsonl` | 逐行解析 |
| 运行中进程 | `/proc/*/cmdline` | 扫描含 `claude-code/cli.js` 的进程 |
| Broker 会话 | 内存 `ClaudeBroker` 单例 | 子进程 stdin/stdout JSON 流通信 |
| 用量统计 | `~/.claude/statsig/` + API 推算 | 解析 token 计数 |
| Git 信息 | 项目目录 `.git/` | `git diff`, `git log` |

---

## 7. 技术架构

### 7.1 后端（Python + FastAPI）

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

### 7.2 前端（TypeScript + Lit + Vite）

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

### 7.3 通信协议

| 场景 | 协议 | 说明 |
|------|------|------|
| 历史数据查询 | REST GET | 会话列表、对话内容、进程列表 |
| 操作 | REST POST | 启动/停止会话 |
| 实时交互 | WebSocket | 对话流、状态推送、权限请求 |

---

## 8. 部署模式

### 8.1 开发模式

```bash
make dev  # 后端 :8420 (uvicorn --reload) + 前端 :5173 (Vite HMR)
```

前端通过 Vite proxy 转发 API 请求到后端。

### 8.2 生产模式

```bash
./start.sh  # 构建前端 → 后端服务静态文件 → 单端口 :8420
```

后端使用 FastAPI `StaticFiles` 挂载 `frontend/dist/`，所有请求走一个端口。

### 8.3 局域网访问

设置 `AUTH_TOKEN` 环境变量后，后端绑定 `0.0.0.0`，手机等设备可通过局域网 IP 访问。首次访问时输入 token 即可。

---

## 9. 设计原则

1. **清晰优于精巧** — 每个文件职责单一，数据流显式
2. **模块隔离** — 每个模块可独立理解、修改和测试
3. **类型化接口** — Python Pydantic + TypeScript 严格模式
4. **约定优于配置** — Python `snake_case`、TypeScript `camelCase`
5. **上下文自包含** — 每个源文件开头注释说明用途
6. **移动优先** — 响应式布局，手机和桌面均可用

---

## 10. 开发规范

- **Python**：snake_case，所有函数加类型标注，数据结构使用 Pydantic
- **TypeScript**：camelCase，严格模式，Lit 装饰器定义组件
- **测试**：后端 pytest + httpx，前端 Vitest，测试文件与源码同目录
- **Git**：提交信息用中文
- **API**：端点装饰器写 summary 和 description
- **文件**：每个源文件开头一行注释说明用途

---

## 更新日志

### 2026-02-19
- 初版产品文档
- 工作台区块划分规则明确：工作中仅显示 agent 正在执行的会话，待命中显示空闲进程
- 徽章规则：最近会话和待命中不显示"运行中"
- 会话命名功能：移除同项目单会话限制，支持并行多会话；自动生成 Docker 风格名称（如 swift-fox），支持自定义命名
- 移除自动接入：viewer 打开时不再自动连接 broker / 自动 resume，改为手动「接入会话」/「恢复会话」
- 会话名称可编辑：session-header 中点击名称内联修改，PATCH API 持久化
- 启动配置可视化：header 下方显示配置摘要（模型·权限·预算·轮数），恢复时对话框预填充
- 双 ID 体系：引入 `claude_session_id`（真实 JSONL ID），修复新建会话输出消失的 bug
