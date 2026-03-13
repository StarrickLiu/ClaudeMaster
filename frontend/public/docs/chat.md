# 交互式会话

ClaudeMaster 不仅能查看历史对话，还能从浏览器直接与 Claude Code 进行实时交互。

## 新建会话

用户从工作台或会话历史页点击「+ 新建会话」：

1. 弹出配置对话框，可设置：
   - **项目目录** — Claude Code 的工作目录
   - **模型** — 使用的 Claude 模型
   - **权限模式** — `bypassPermissions`（自动批准）或手动审批
   - **预算上限** — 最大花费（USD）
   - **最大轮数** — 自动停止的对话轮数
   - **追加系统提示** — 附加到 Claude 系统提示的自定义指令
   - **额外目录** — 多项目上下文
2. 后端 `POST /api/chat/start` 启动 Claude Code 子进程
3. 返回 `session_id` 后，前端跳转到对话查看器
4. 通过 WebSocket `/ws/chat/{session_id}` 建立实时通信

## 实时聊天

对话查看器检测到当前会话有活跃的 broker 进程时，自动切换为聊天模式：

- 底部显示消息输入框
- 发送的消息通过 WebSocket 传递给 broker，broker 写入 Claude Code stdin
- Claude Code 的输出通过 stdout JSON 流实时推送到前端
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

> **注意**：在 `stream-json` 模式下，Claude Code 即使在 `bypassPermissions` 模式下也会发送 `control_request` 事件并等待 `control_response`。Broker 检测到 `bypassPermissions` 模式时会自动回复 `allow`，不转发给前端。

## 恢复会话

对于已有 JSONL 记录的会话，可通过 `resume_session_id` 恢复到 Claude Code 的历史上下文。这让用户可以：
- 继续之前未完成的工作
- 在 Web 界面中接管终端启动的会话
