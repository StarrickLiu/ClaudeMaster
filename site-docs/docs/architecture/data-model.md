# 数据模型

ClaudeMaster 的数据源自 Claude Code 的本地文件系统。

## 文件系统布局

```
~/.claude/
  .credentials.json                  # OAuth 凭证（绝不暴露）
  settings.json                      # 用户级设置
  history.jsonl                      # 全局消息索引
  stats-cache.json                   # 使用统计

  projects/
    <项目路径用短横线连接>/             # 例如 -home-star-codes-MyProject
      <会话UUID>.jsonl                # 完整对话记录
      <会话UUID>/
        subagents/
          agent-<短ID>.jsonl          # 子代理对话记录
```

## JSONL 对话格式

每个会话的 `.jsonl` 文件中，每一行是一个 JSON 对象：

```json
{
  "type": "user | assistant",
  "uuid": "消息UUID",
  "parentUuid": "父消息UUID",
  "sessionId": "会话UUID",
  "version": "2.1.42",
  "gitBranch": "main",
  "cwd": "/home/user/project",
  "timestamp": "2025-02-17T10:30:00.000Z",
  "message": {
    "role": "user | assistant",
    "content": [
      {"type": "text", "text": "..."},
      {"type": "tool_use", "id": "...", "name": "Read", "input": {}},
      {"type": "tool_result", "tool_use_id": "...", "content": "..."},
      {"type": "thinking", "thinking": "..."}
    ]
  }
}
```

### 内容块类型

| 类型 | 说明 |
|------|------|
| `text` | 纯文本或 Markdown |
| `tool_use` | 工具调用请求 |
| `tool_result` | 工具执行结果 |
| `thinking` | Claude 的思维过程 |

### 消息树结构

通过 `parentUuid` 字段，消息形成树结构，支持对话分支。ClaudeMaster 解析时会合并被拆分的 assistant 消息，关联 `tool_use` 和 `tool_result`。

## 双 ID 体系

Broker 管理的会话有两个 ID：

| ID | 来源 | 用途 |
|----|------|------|
| `session_id`（initial_id） | 启动时分配（新建为 UUID，恢复为原 ID） | URL、WebSocket、Broker 查找 |
| `claude_session_id` | Claude CLI 在 `init` 事件中分配 | JSONL 文件名、历史数据加载 |

!!! info "为什么需要两个 ID"
    新建会话时，ClaudeMaster 在启动 CLI 之前就需要一个 ID 来建立 WebSocket 连接（`initial_id`）。而 Claude 分配的真实 ID 要等 CLI 初始化后才能获得。恢复会话时，`initial_id` 等于原始 `session_id`，保持 URL 稳定。

## 全局历史

`~/.claude/history.jsonl` 中记录每条用户消息的索引：

```json
{
  "display": "用户消息摘要",
  "projectPath": "/home/user/project",
  "sessionId": "会话UUID",
  "timestamp": "2025-02-17T10:30:00.000Z"
}
```

## 会话命名

会话名称存储在 `~/.claude/cm_session_names.json`：

- **自动命名**：Docker 风格随机名称（如 `swift-fox`、`calm-oak`）
- **手动重命名**：在 viewer 中内联编辑
- **双写**：重命名时同时更新 Broker 会话和 name store

## 会话解析策略

JSONL 文件可能很大（数千条消息），ClaudeMaster 采用以下策略：

1. **懒加载**：首次请求时解析并缓存
2. **增量更新**：使用 `watchdog` 检测文件变更
3. **摘要缓存**：内存中保存会话摘要
4. **分页加载**：每页 50 条消息
