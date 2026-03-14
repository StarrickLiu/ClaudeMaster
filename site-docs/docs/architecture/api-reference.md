# API 参考

## REST 端点

### 项目

```
GET /api/projects
→ [{ path, name, sessionCount, lastActivity }]
```

### 会话

```
GET /api/sessions?project=<path>&limit=50&offset=0&search=<text>
→ { items: [SessionSummary], total: number }

GET /api/sessions/:sessionId
→ { session: Session, messages: [Message] }

GET /api/sessions/:sessionId/subagents
→ [{ agentId, messages: [Message] }]
```

### 历史

```
GET /api/history?limit=100&offset=0
→ { items: [HistoryEntry], total: number }
```

### 进程

```
GET /api/processes
→ [{ pid, sessionId, project, uptime, status }]

POST /api/processes/start
body: { projectPath, prompt?, resumeSessionId? }
→ { pid, sessionId }

POST /api/processes/:pid/stop
→ { success: boolean }
```

### 交互式会话

```
POST /api/chat/start
body: { project_path, resume_session_id?, model?, allowed_tools?, ... }
→ ChatSessionInfo

GET /api/chat/sessions
→ [ChatSessionInfo]

PATCH /api/chat/:sessionId
body: { name? }
→ ChatSessionInfo

POST /api/chat/:sessionId/stop
→ { success: boolean }
```

### 用量统计

```
GET /api/usage
→ UsageResponse { today, window_5h, daily }

GET /api/usage/chart?days=7|14|30
→ [DailyUsage { date, total_tokens, cost_usd, message_count }]

GET /api/quota
→ QuotaResponse { five_hour, seven_day, subscription_type }
```

### Git 差异

```
GET /api/diff?project_path=<path>
→ { diff, stat }

GET /api/commits?project_path=<path>&limit=20
→ [CommitInfo { hash, subject, author, date, stat, insertions, deletions }]

GET /api/commit?project_path=<path>&hash=<hash>
→ { diff }
```

### Agent 管理

```
GET /api/agents
→ [AgentInfo { agent_id, hostname, display_name, state, mode, latency_ms, ... }]

GET /api/agents/:agentId/processes
→ [RemoteProcess { pid, cwd, uptime_seconds, managed }]

GET /api/agents/:agentId/sessions
→ [SessionSummary]

GET /api/agents/:agentId/sessions/:sessionId
→ SessionDetail

POST /api/agents/:agentId/kill-processes
body: { pids: [int] }
→ { killed: [int], failed: [int] }

PATCH /api/agents/:agentId
body: { display_name? }
→ { agent_id, display_name }
```

`ChatSessionInfo` 包含：

| 字段 | 说明 |
|------|------|
| `session_id` | 稳定标识（initial_id） |
| `claude_session_id` | Claude 真实 ID（可能为 null） |
| `name` | 会话名称 |
| `state` | 会话状态 |
| `launch_config` | 启动参数 |
| `source` | 来源：`local` 或 `remote` |
| `hostname` | 远程主机名（仅 remote） |

## WebSocket 端点

### 浏览器聊天 `/ws/chat/{session_id}`

连接地址：`ws://host:port/ws/chat/{session_id}?token=<auth_token>`

#### 服务端 → 客户端

```json
// 初始状态
{"type": "_state", "session_id": "real-claude-id", "state": "idle"}

// Claude stdout 事件
{"type": "system", "subtype": "init", "session_id": "..."}
{"type": "stream_event", "event": {"type": "content_block_delta"}}
{"type": "result", "stats": {"input_tokens": 1000, "output_tokens": 500}}

// 权限请求
{"type": "control_request", "request_id": "...", "request": {
    "type": "can_use_tool", "tool_name": "Bash", "input": {"command": "..."}
}}

// 进程关闭
{"type": "_internal", "subtype": "closed"}
```

#### 客户端 → 服务端

```json
// 发送消息
{"type": "user_message", "text": "..."}

// 回复权限
{"type": "control_response", "request_id": "...", "behavior": "allow|deny",
 "updated_input": {}, "message": "..."}

// 中断
{"type": "interrupt"}
```

### Agent 接入 `/ws/agent/{client_id}`

连接地址：`ws://host:port/ws/agent/{client_id}?token=<auth_token>`

#### Agent → 服务端

```json
// 注册（连接后第一条消息，支持 daemon/oneshot 模式）
{"type": "register", "hostname": "...", "mode": "daemon",
 "allowed_paths": ["/home/user/projects"], "agent_version": "0.2.0"}

// Claude 事件转发
{"type": "event", "session_id": "...", "event": {}}

// 状态报告
{"type": "agent_status", "session_id": "...", "status": "claude_exited", "exit_code": 0}

// 进程列表上报
{"type": "processes", "items": [...], "sessions": [...]}

// 会话启动结果
{"type": "session_started", "request_id": "...", "session_id": "..."}
{"type": "session_start_failed", "request_id": "...", "error": "..."}

// 心跳回复
{"type": "pong", "ts": 1234567890}
```

#### 服务端 → Agent

```json
// 注册确认
{"type": "registered", "agent_id": "...", "mode": "daemon"}

// 启动会话（daemon 模式）
{"type": "start_session", "request_id": "...", "project_path": "...",
 "claude_args": ["--model", "opus"], "name": "swift-fox"}

// 停止会话
{"type": "stop_session", "session_id": "..."}

// 用户消息
{"type": "user_message", "text": "...", "source": "web", "session_id": "..."}

// 权限回复
{"type": "control_response", "request_id": "...", "behavior": "allow",
 "session_id": "..."}

// 心跳
{"type": "ping", "ts": 1234567890}
```

## 进程检测

通过扫描 `/proc/*/cmdline` 查找包含 `claude-code/cli.js` 的进程：

- 从 `/proc/<pid>/environ` 提取环境变量
- 读取 `/proc/<pid>/cwd` 获取工作目录
- 检测 `CLAUDECODE=1` 环境变量标识
