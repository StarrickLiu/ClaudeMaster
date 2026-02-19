# ClaudeMaster 开发进度

> 最后更新：2026-02-17

---

## 当前状态：重构阶段进行中

---

## 一、重构计划

### 模块一：删除 Review 死代码 ✅ 完成
> 整个基于 git-diff 的"代码审查"系统是错误概念的产物，已完成清理逻辑，但基础设施文件尚存

- [x] 移除 `claude_broker.py` 中的 `_check_review()` 自动触发
- [x] 移除 `viewer.ts` 中的 `_renderReviewBanners()` 和相关 state
- [x] 删除后端文件：`models/review.py`, `routers/reviews.py`, `services/review_store.py`
- [x] 删除前端文件：`pages/reviews.ts`, `pages/review-detail.ts`, `components/review-card.ts`
- [x] 清理 `main.py`、`config.py`、`api.ts`、`dashboard.ts`、`main.ts` 中的 review 引用

### 模块二：修复 stream-json 协议层 ✅ 完成

- [x] 修正 `control_response` 格式：`request_id` 移到顶层，deny 时发 `message` 不发 `updatedInput`
- [x] `start_session()` 等待 `init` 事件后再返回，确保 session_id 为 Claude 真实分配的 ID
- [x] 为 `start_session()` 和 `StartChatRequest` 加入 `allowed_tools`、`permission_mode`、`max_budget_usd`、`max_turns`、`append_system_prompt` 参数
- [x] `AskUserQuestion` 工具在 `permission-dialog.ts` 中特殊处理：展示结构化问题和选项按钮
- [x] `init` 事件的真实 session_id 通过 `session-id` 事件回传前端（`chat-client.ts`）

### 模块三：补充缺失的流式事件处理 ✅ 完成
- [x] `chat-client.ts` 处理 `thinking_delta`，发出 `thinking-delta` 事件
- [x] `viewer.ts` 中 streaming 区域支持显示思考内容（可折叠 `<details>`）
- [x] 从 `result` 事件提取 `stats`（token 消耗 + 成本），通过 `result-stats` 事件发出
- [x] viewer 底部实时展示本次对话消耗（token 数 + 预估成本）

### 模块四：拆分 Viewer 大组件 ✅ 部分完成
> viewer.ts 超过 1000 行，承担过多职责

- [x] 提取 `session-header.ts`（标题、元信息、恢复/断开按钮）
- [x] 提取 `session-summary.ts`（摘要卡片）
- [x] 删除 viewer.ts 中的 review 死代码 CSS
- [ ] 提取 `chat-panel.ts`（消息流渲染、流式输出、ChatClient 管理）
- [ ] `viewer.ts` 精简为页面壳（目标 < 200 行）

---

## 二、功能拓展计划

### 第一期：把工具变成生产力平台

#### F1-1 会话启动配置器 ✅ 完成
> 文档依据：`--model`, `--permission-mode`, `--allowedTools`, `--max-budget-usd`, `--max-turns`, `--append-system-prompt`

启动会话时弹出配置面板，支持：
- 模型选择（Sonnet / Opus / Haiku）
- 权限模式（默认 / 自动接受编辑 / 仅计划 / 跳过所有权限）
- 工具权限预设（只读 / 无 Bash / 完全 / 自定义）
- 最大花费上限（$）
- 最大轮数
- 附加系统提示（可选文本）

涉及文件：`chat.py`、`claude_broker.py`、`viewer.ts`（启动配置对话框）

#### F1-2 浏览器通知 ✅ 完成
> 文档依据：`control_request`（等待权限）、`result`（Claude 完成）

当用户切换 Tab 时推送桌面通知：
- Claude 等待权限确认时：`"Claude 正在等待您的授权"`
- Claude 完成任务时：`"Claude 已完成任务"`

纯前端实现，`chat-client.ts` 中监听对应事件，调用 Web Notifications API。

#### F1-3 工具调用活动时间线 ✅ 完成
> 文档依据：`content_block_start` 中 `type == "tool_use"` 表示工具调用开始

在 viewer 右侧或 chat-panel 底部显示实时活动日志，记录 Claude 当前正在做什么：
- `● 执行 Bash: npm test`
- `● 读取 src/auth.ts`
- `● 编辑 backend/models/user.py`

`chat-client.ts` 监听 `stream_event` 中的工具调用事件，发出 `tool-activity` 事件。

#### F1-4 实时成本监控 ✅ 完成（含在模块三）
> 文档依据：`result` 事件包含 `stats.input_tokens`、`stats.output_tokens`

在聊天界面底部显示本次会话累计成本：`本次 $0.023 | 今日 $1.24`

依赖模块三中 `result` 事件 stats 提取的完成。

---

### 第二期：从管理走向编排

#### F2-1 一次性任务执行器 ⬜ 待开始
> 文档依据：`claude -p "query" --output-format stream-json`

独立于交互式会话，直接运行一次性任务并流式展示结果：
- 新增后端接口 `POST /api/task/run`（启动 `claude -p`，SSE 流式返回）
- 新增前端页面 `pages/task-runner.ts`
- 支持：项目路径、提示词、模型、allowedTools、最大花费

#### F2-2 CLAUDE.md 编辑器 ⬜ 待开始
> 文档依据：CLAUDE.md 是 Claude 每次会话加载的项目指令

在项目详情页增加 CLAUDE.md 查看/编辑入口：
- `GET /api/projects/{project}/claude-md`
- `PUT /api/projects/{project}/claude-md`
- 前端：带语法高亮的 Markdown 编辑器

#### F2-3 会话 Fork ⬜ 待开始
> 文档依据：`claude --resume {id} --fork-session`

在交互式聊天界面增加"Fork 会话"按钮，创建从当前对话分叉的新会话：
- `broker.start_session()` 增加 `fork=True` 参数
- 新会话在新的 viewer 标签页打开

---

### 第三期：成为完整控制中心

#### F3-1 Sub-agent 执行树可视化 ⬜ 待开始
> 文档依据：`parent_tool_use_id` 标识 sub-agent 消息；sub-agent JSONL 存在 `subagents/` 子目录

在 viewer 中将 Task 工具调用和 sub-agent 消息渲染为树形结构：
- 主会话消息 → Task 工具调用 → sub-agent 消息列表
- 支持点击 Task 节点展开/折叠 sub-agent 内容

#### F3-2 权限规则管理器 ⬜ 待开始
> 文档依据：`allowedTools` 支持 pattern matching（如 `Bash(git *)`）

可视化管理 `--allowedTools` 规则，支持保存多个权限预设并在启动时选择。

#### F3-3 Sub-agent 定义管理器 ⬜ 待开始
> 文档依据：`.claude/agents/*.md` 为自定义 sub-agent 定义文件

在 Web UI 中管理项目级和用户级 sub-agent 定义：
- 列表显示、查看、创建、编辑、删除 `.claude/agents/*.md` 文件
- 可视化配置 tools、model、permissionMode
- 内置模板（代码审查者、调试助手、数据分析师等）

---

## 三、开发日志

### 2026-02-17

**已完成（会话前）**
- 初始 MVP 提交：会话历史、WebSocket 交互、使用量统计

**已完成（本次会话）**
- 定位并修复"每次发消息出现审查请求"的 bug：
  - 根本原因是 `_check_review()` 在每次 `result` 事件后自动触发 git-diff 审查
  - 移除 `claude_broker.py` 中的 `_check_review()` 方法及触发调用
  - 移除 `viewer.ts` 中的 `_renderReviewBanners()`、`sessionReviews` 等相关代码
- 阅读官方文档（headless、CLI reference、Agent SDK、hooks、sub-agents），完成代码审查
- 确定重构方案（4 个模块）
- 确定功能拓展路线（10 个特性，分三期）

**已完成（本轮开发）**
- 模块一完成：彻底删除所有 Review 死代码（6 个文件 + 5 个文件中的引用）
- 模块二完成：
  - 修正 `control_response` 格式（request_id 移到顶层，deny 添加 message 字段）
  - `start_session()` 等待 init 事件，确保返回的 session_id 为 Claude 真实分配的 ID
  - 新增参数：`allowed_tools`、`permission_mode`、`max_budget_usd`、`max_turns`、`append_system_prompt`
  - `AskUserQuestion` 在 permission-dialog 中特殊渲染问题和选项
  - `init` session_id 通过 `session-id` 事件回传前端
- 模块三完成：
  - `thinking_delta` 处理 + 流式思考内容可折叠展示
  - `result` stats 提取 + 底部实时成本展示
- 模块四部分完成：
  - 新增 `session-header.ts`、`session-summary.ts` 组件
  - viewer.ts 删除死代码 CSS

- 第一期功能全部完成：
  - F1-1 会话启动配置器：新增 `launch-config-dialog.ts`，点击"恢复会话"弹出配置面板
  - F1-2 浏览器通知：页面隐藏时等待授权/完成任务发送桌面通知
  - F1-3 工具调用活动时间线：streaming 期间实时显示 Claude 正在调用的工具
  - F1-4 实时成本监控：每轮对话后底部展示 token 消耗和成本

- 配额余量显示：
  - 新增 `services/quota_service.py`，读取 `~/.claude/.credentials.json` 中的 OAuth token
  - 调用 Anthropic 非公开 `/api/oauth/usage` 接口获取 5h/7d 真实用量百分比
  - 新增 `GET /api/quota` 后端路由
  - `usage-card.ts` 新增配额进度条（剩余百分比 + 重置倒计时）
  - 修复：前端遗留的 `GET /api/reviews` 404 是浏览器缓存，强制刷新（Ctrl+Shift+R）即可

- 用量图表增强：
  - 新增 `GET /api/usage/chart?days=N` 后端路由（7/14/30 天可切换）
  - `usage_service.py` 新增 `get_daily_chart()` + 独立缓存（2 分钟）
  - `usage-card.ts` 完全重写图表区：
    - 自管理图表数据（`connectedCallback` 自动加载）
    - 时间跨度切换 Tab（7天 / 14天 / 30天）
    - Y 轴参考值标签（max / 75% / 50% / 25% / 0）
    - 参考线（CSS linear-gradient 实现）
    - 柱体上方值标签（`_fmtShort()`：65.1M / 658K）
    - 今日柱体高亮（primary 色 + 不透明度 0.9）
    - 零值柱体灰色占位 stub
    - 悬停 tooltip（显示完整日期、tokens、费用、消息数）
    - 日期标签智能间隔（7天每天 / 14天每2天 / 30天每5天）

### 2026-02-19（会话设置编辑 + 移除自动接入）

**已完成**

- 移除自动接入：viewer 打开时不再自动连接 broker 或 24h 自动 resume
  - 删除 `autoConnecting` 状态属性及 3 条自动接入分支
  - 新增 `_activeBrokerSession` 仅记录元数据
  - 保留 dashboard 新建会话通过 sessionStorage `cm_new_session_autoattach` 标记的自动接入
- session-header 改造：
  - 内联名称编辑：点击名称进入编辑模式，Enter 确认 / Esc 取消
  - 移除 `autoConnecting` 属性，新增 `hasActiveBroker` 显示「接入会话」按钮
  - 新增 `launchConfig` 属性，渲染配置摘要标签（模型·权限·预算·轮数）
- launch-config-dialog 预填充：
  - 新增 `initialConfig` 属性，对话框打开时用当前 launch_config 填充
  - 支持 snake_case 后端格式直接读取
- 后端 launch_config 存储：
  - `ClaudeSession` 新增 `launch_config` 字段
  - `start_session()` 创建后存储所有启动参数
  - `list_sessions()` 和 `ChatSessionInfo` 返回 `launch_config`
- 会话改名 API：
  - 新增 `PATCH /api/chat/{session_id}` 端点
  - 前端 `api.ts` 新增 `requestPatch` + `updateChatSession`
  - viewer `_onRename` handler 调用 API 持久化
- 双 ID 体系（修复新建会话输出消失 bug）：
  - 后端 `ChatSessionInfo` 新增 `claude_session_id`（真实 JSONL ID）
  - ChatClient `_state` 事件提取 `session_id` 并 emit `session-id`
  - viewer `_resolveSessionId()` 优先用 `brokerSessionId` → `claude_session_id` → URL sessionId
  - viewer `_load()` 失败时用 `claude_session_id` 重试加载 JSONL
  - result handler 合成保底消息防止 reload 失败时输出消失

**待开始**
- 第二期功能：一次性任务执行器、CLAUDE.md 编辑器、会话 Fork
- 模块四剩余：提取 chat-panel，精简 viewer.ts 到 < 200 行
