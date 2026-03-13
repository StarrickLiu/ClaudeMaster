# 多客户端架构

ClaudeMaster v0.3.0 引入了多客户端接入架构，使远程机器上的 Claude Code 也能接入管理。

## 架构概览

```mermaid
graph TB
    subgraph 本地
        Broker[ClaudeBroker] --> LocalCLI[Claude CLI]
    end

    subgraph 远程机器A
        AgentA[cm-agent] --> CliA[Claude CLI]
    end

    subgraph 远程机器B
        AgentB[cm-agent] --> CliB[Claude CLI]
    end

    subgraph 服务端
        Registry[SessionRegistry]
        Hub[ClientHub]
        Broker
    end

    Registry -->|本地会话| Broker
    Registry -->|远程会话| Hub
    AgentA -->|WebSocket| Hub
    AgentB -->|WebSocket| Hub

    WS[浏览器 WebSocket] --> Registry
```

## 核心组件

### cm-agent (`agent/cm_agent.py`)

客户端 sidecar 程序，在远程机器上运行：

- 启动 Claude CLI 子进程（与 Broker 使用相同的 stream-json 参数）
- 通过 WebSocket 连接到 ClaudeMaster 服务端
- 双向转发 Claude 事件和用户消息
- 支持终端和网页同时交互
- 断线自动重连（指数退避，最大 30 秒）

### ClientHub (`backend/services/client_hub.py`)

服务端的远程连接管理器：

- 维护所有 `RemoteSession` 实例
- `RemoteSession` 接口与 `ClaudeSession` 一致（subscribe/unsubscribe/状态管理）
- 处理 agent 注册、断线重连、超时清理
- 断线后保留会话 5 分钟，期间重连可恢复

### SessionRegistry (`backend/services/session_registry.py`)

统一的会话索引层：

- 合并 Broker（本地）和 ClientHub（远程）的会话
- 提供统一的 `get_session`、`list_all_sessions` 接口
- 自动路由 `send_message`、`send_control_response`、`send_interrupt` 到正确的后端
- 上层代码（WebSocket handler、路由）无需关心会话来源

## 通信协议

### Agent → 服务端

```json
// 注册
{"type": "register", "client_id": "hex-uuid", "hostname": "my-laptop",
 "project_path": "/home/user/project", "agent_version": "0.1.0"}

// Claude stdout 事件转发
{"type": "event", "event": {"type": "system", "subtype": "init", ...}}

// Claude 进程退出
{"type": "agent_status", "status": "claude_exited", "exit_code": 0}
```

### 服务端 → Agent

```json
// 注册确认
{"type": "registered", "session_id": "stable-id", "name": "swift-fox"}

// 网页用户消息
{"type": "user_message", "text": "请修复这个 bug", "source": "web"}

// 权限回复
{"type": "control_response", "request_id": "req-1", "behavior": "allow"}

// 中断指令
{"type": "interrupt"}
```

## RemoteSession 状态

远程会话的状态与本地会话一致：

| 状态 | 说明 |
|------|------|
| `starting` | 刚注册，等待 Claude 初始化 |
| `idle` | Claude 空闲，等待输入 |
| `streaming` | Claude 正在生成回复 |
| `waiting_permission` | 等待工具权限审批 |
| `disconnected` | agent 断线，等待重连（5 分钟超时） |
| `closed` | 会话已结束 |

## 前端适配

远程会话在前端的表现：

- 工作台上会话卡片显示来源标记（`remote`）和主机名
- `GET /api/chat/sessions` 返回的会话列表包含 `source`、`hostname`、`client_id` 字段
- 所有交互操作（发消息、审批权限、中断）通过 SessionRegistry 统一路由，前端无需区分来源
