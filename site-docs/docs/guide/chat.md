# 交互式会话

ClaudeMaster 不仅能查看历史对话，还能从浏览器直接与 Claude Code 进行实时交互。

## 新建会话

从工作台或会话历史页点击「+ 新建会话」：

1. 弹出配置对话框，设置项目目录、模型、权限模式等参数
2. 后端 `POST /api/chat/start` 启动 Claude Code 子进程
3. 前端跳转到对话查看器
4. 通过 WebSocket `/ws/chat/{session_id}` 建立实时通信

## 实时聊天

对话查看器检测到当前会话有活跃的 broker 进程时，自动切换为聊天模式：

- 底部显示消息输入框
- 发送的消息通过 WebSocket 传递给 broker，broker 写入 Claude Code stdin
- Claude 的输出通过 stdout JSON 流实时推送到前端
- 支持中断当前执行（发送 interrupt 指令）

## 权限审批

当 Claude Code 请求使用需审批的工具时：

1. Broker 捕获 `control_request` 事件，状态变为 `waiting_permission`
2. 前端弹出权限对话框，显示工具名和输入参数
3. 用户可选择：
    - **Allow** — 批准执行
    - **Deny** — 拒绝执行
    - **修改参数后 Allow** — 调整输入参数后批准
4. 响应通过 WebSocket 发回 broker，broker 写入 stdin

!!! note "bypassPermissions 模式"
    在 `stream-json` 模式下，Claude Code 即使在 `bypassPermissions` 模式下也会发送 `control_request` 事件。Broker 检测到该模式时会自动回复 `allow`，不转发给前端。

## 恢复会话

对于已有 JSONL 记录的会话，可通过「恢复会话」按钮恢复到 Claude Code 的历史上下文：

- 继续之前未完成的工作
- 在 Web 界面中接管终端启动的会话

!!! tip "自动接入"
    从工作台新建的会话会通过 `sessionStorage` 标记自动接入 broker。其他场景需要用户手动点击「接入会话」或「恢复会话」。
