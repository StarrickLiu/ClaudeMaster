# RFC: 统一 Agent 管理

> 状态：草案
> 日期：2026-03-13

---

## 1. 用户画像

### 核心用户

一个全栈开发者 / AI 应用研究员，同时使用多台机器进行开发工作：

- **本地工作站**（家里的台式机）— 主力开发环境
- **云开发机**（阿里云 DSW / AutoDL 等）— GPU 训练、大规模数据处理
- **公司服务器**（通过 SSH 访问）— 内网项目

他在每台机器上都会启动若干 Claude Code 会话来辅助编码，有时候同一台机器上同时跑着 3-5 个会话。他经常需要在**手机上**查看和管理这些会话的状态——比如通勤时审批权限请求、检查任务进度、给某个会话发新指令。

### 核心痛点

1. **机器身份混乱** — 远程机器的 hostname 是 `dsw-512634-7fb79bf788-xmp5c` 这种 K8s pod 名，看不出是哪台机器，每次都要回忆
2. **本地与远程割裂** — 本地会话和远程会话分开展示，但用户心智中它们没有区别，"都是我的 Claude"
3. **无法纵览全局** — 想知道"我总共有几台机器在线、跑了多少进程、今天消耗了多少"，目前要自己拼凑
4. **远程机器黑盒** — 远程 agent 连没连上、延迟多少、上次通信什么时候，完全看不到
5. **管理操作缺失** — 想给机器改个名字、想断开一个 agent、想看某台机器的历史统计，都做不到

### 用户期望

> "我打开工作台，一眼看到：3 台机器在线，7 个会话在跑，1 个等我审批。
> 点开某台机器，看到它的所有进程和最近会话。
> 远程机器用我自己取的名字显示——'GPU 服务器'而不是一串哈希。"

---

## 2. 设计原则

1. **本机即 Agent** — ClaudeMaster 服务器所在的机器也是一个 agent（内置的、永远在线的），与远程 agent 统一模型
2. **无感融合** — 用户不需要区分"这是本地还是远程"，所有会话/进程统一展示，机器信息只是一个标签
3. **命名优先** — 用户可以给每台机器取一个友好名称（如"工作站"、"GPU 服务器"），所有界面优先使用友好名称
4. **状态透明** — 每台机器的连接状态、延迟、最后心跳时间等运维指标清晰可见
5. **渐进式** — 没有远程 agent 时，系统行为与现在完全一致（本机 agent 隐含存在，不需要额外配置）

---

## 3. 核心概念重定义

### 3.1 Agent（机器）

一台运行 Claude Code 的机器。每个 agent 有：

| 属性 | 说明 |
|------|------|
| `agent_id` | 唯一标识（本机使用固定值 `"local"`） |
| `display_name` | 用户自定义友好名称（如"工作站"、"GPU 服务器"），默认为 hostname |
| `hostname` | 系统 hostname（不可编辑，作为技术参考） |
| `type` | `"local"` 或 `"remote"` |
| `state` | `"online"` / `"offline"` / `"connecting"`（本机永远 online） |
| `latency_ms` | WebSocket 往返延迟（本机为 0） |
| `last_heartbeat` | 最后一次心跳时间 |
| `process_count` | 当前 Claude Code 进程数 |
| `session_count` | 当前托管会话数（通过 ClaudeMaster 启动的） |
| `agent_version` | cm-agent 版本号（本机显示 ClaudeMaster 版本） |
| `connected_at` | 本次连接建立时间 |

### 3.2 本机 Agent

ClaudeMaster 服务器自身视为一个特殊 agent：
- `agent_id = "local"`，`type = "local"`
- 不通过 WebSocket 通信，直接调用本地 `scan_claude_processes()` + `ClaudeBroker`
- 状态永远 `"online"`，延迟 `0ms`
- 进程信息来自本地 `/proc` 扫描
- 会话由 `ClaudeBroker` 直接管理

这意味着 dashboard 的所有逻辑可以统一为 "遍历 agents，展示其会话和进程"。

### 3.3 会话与进程的归属

每个会话和进程都属于一个 agent：

- **Broker 会话**（本地 ClaudeBroker 管理的）→ 归属 local agent
- **远程托管会话**（通过 cm-agent 启动的）→ 归属对应 remote agent
- **本地 legacy 进程**（/proc 扫描发现的）→ 归属 local agent
- **远程非托管进程**（cm-agent 上报的）→ 归属对应 remote agent

---

## 4. Agent 管理页面

新增页面 `#/agents`，导航栏增加入口。

### 4.1 Agent 列表

```
┌─────────────────────────────────────────────────────────┐
│  机器管理                                    [+ 添加机器] │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ● 工作站                              本机 · 4 个进程   │
│    star-desktop                        1 个托管会话      │
│                                                         │
│  ● GPU 服务器                     在线 · 延迟 42ms       │
│    dsw-512634-7fb79bf788-xmp5c         3 个进程          │
│    连接于 2 小时前                      cm-agent 0.2.0   │
│                                                         │
│  ○ 公司服务器                           离线             │
│    office-dev-01                  最后在线：昨天 18:30    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

每行一台机器，点击进入 Agent 详情页。

### 4.2 Agent 详情页

```
┌─────────────────────────────────────────────────────────┐
│  ← 返回    GPU 服务器  ✏️                 [断开连接]      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  连接信息                                               │
│  ─────────                                              │
│  状态：● 在线          延迟：42ms                        │
│  hostname：dsw-512634-7fb79bf788-xmp5c                  │
│  agent 版本：0.2.0    连接于：2026-03-13 10:23          │
│  允许目录：/home/star/projects, /mnt/data               │
│                                                         │
│  当前进程 (3)                                            │
│  ─────────                                              │
│  wall-x         PID 2816697    运行 25h   /home/.../x   │
│  openpi         PID 2948955    运行 1h    /home/.../pi  │
│  openpi         PID 2950287    运行 1h    /home/.../pi  │
│                                                         │
│  托管会话 (0)                                            │
│  ─────────                                              │
│  （暂无通过 ClaudeMaster 启动的会话）                    │
│                                                         │
│  [+ 在此机器新建会话]                                    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 4.3 编辑名称

点击名称旁的编辑图标，内联编辑。修改后通过 API 持久化。

### 4.4 "添加机器" 引导

点击 [+ 添加机器] 弹出对话框，展示连接命令：

```
在远程机器上运行：

pip install claudemaster-agent
cm-agent --server wss://your-server:8420 --token YOUR_TOKEN

或设置环境变量后运行：
export CM_AUTH_TOKEN=YOUR_TOKEN
cm-agent --server wss://your-server:8420
```

---

## 5. 工作台改进

### 5.1 统一 agent 标签

所有会话/进程卡片上，用 agent 的 `display_name` 作为标签（小 badge）。
本机 agent 的标签可以配置是否显示（只有一台机器时不需要显示）。

规则：
- 仅有本机 agent → 不显示 badge（减少噪音）
- 有 >= 2 个 agent → 所有卡片都显示 badge

### 5.2 全局概览栏（可选）

在今日用量下方增加一行概览：

```
3 台机器在线 · 7 个进程 · 12 个会话 · 1 个待审批
```

仅在有远程 agent 时显示。

### 5.3 待命中修正

如之前讨论的，待命中只放真正有活跃进程/会话的条目：
- Broker idle/disconnected 会话
- 本地 legacy 进程（24h 内活跃的）
- 远程非托管进程

24h JSONL 历史会话移入最近项目。

### 5.4 最近项目保持按项目分组

已实现。不再赘述。

---

## 6. 数据模型变更

### 6.1 后端新增：AgentConfig 持久化

新增配置文件 `~/.config/claudemaster/agents.json`：

```json
{
  "local": {
    "display_name": "工作站"
  },
  "a1b2c3d4e5f6": {
    "display_name": "GPU 服务器"
  }
}
```

用途：
- 持久化 `display_name`（不丢失用户自定义名称）
- 即使 agent 断线重连，名称依然保留
- 即使 ClaudeMaster 重启，名称依然保留

### 6.2 AgentConnection 扩展

```python
@dataclass
class AgentConnection:
    # 现有字段...
    display_name: str = ""          # 用户自定义名称
    connected_at: str = ""          # 本次连接时间（ISO 格式）
    last_heartbeat: str = ""        # 最后心跳时间
    latency_ms: float = 0           # 最近一次 ping-pong 延迟
```

### 6.3 本机 Agent 虚拟对象

在 `ClientHub`（或新的 `AgentManager` 服务）中，启动时创建一个虚拟的本机 agent：

```python
self._local_agent = AgentConnection(
    agent_id="local",
    hostname=socket.gethostname(),
    display_name=config.get("local", {}).get("display_name", "本机"),
    mode="local",
    state="connected",
)
```

本机 agent 不走 WebSocket，进程列表由 `process_manager.scan_claude_processes()` 提供，会话由 `ClaudeBroker` 管理。

---

## 7. API 变更

### 7.1 Agent 列表（增强）

```
GET /api/agents

响应增加 local agent，字段扩展：
[
  {
    "agent_id": "local",
    "hostname": "star-desktop",
    "display_name": "工作站",
    "type": "local",
    "state": "online",
    "latency_ms": 0,
    "last_heartbeat": "2026-03-13T07:22:06Z",
    "process_count": 4,
    "session_count": 1,
    "agent_version": "0.5.0",
    "connected_at": "2026-03-13T05:00:00Z",
    "mode": "local",
    "allowed_paths": []
  },
  {
    "agent_id": "a1b2c3d4",
    "hostname": "dsw-512634-7fb79bf788-xmp5c",
    "display_name": "GPU 服务器",
    "type": "remote",
    "state": "online",
    "latency_ms": 42,
    ...
  }
]
```

### 7.2 Agent 改名

```
PATCH /api/agents/{agent_id}
Body: { "display_name": "GPU 服务器" }

响应: { "agent_id": "a1b2c3d4", "display_name": "GPU 服务器" }
```

持久化到 `agents.json`。

### 7.3 Agent 进程列表（统一）

```
GET /api/agents/{agent_id}/processes

本机：调用 scan_claude_processes()
远程：返回 agent.processes
```

### 7.4 延迟探测（心跳增强）

远程 agent 的 WebSocket 通信增加 ping-pong 机制：

```
Server → Agent:  {"type": "ping", "ts": 1710000000000}
Agent  → Server: {"type": "pong", "ts": 1710000000000}
```

服务端收到 pong 后计算 `latency_ms = now - ts`，更新 `agent.latency_ms` 和 `agent.last_heartbeat`。

心跳间隔：30 秒。

---

## 8. 前端变更

### 8.1 新增页面：`#/agents`

- `frontend/src/pages/agents.ts` — Agent 管理列表页
- 导航栏增加"机器"入口

### 8.2 Dashboard 改造

- `ChatSessionInfo` 和进程数据上已有 `source`、`hostname`、`agent_id` 字段
- 用 `agent_id` 查找 agent 的 `display_name`，替代 raw hostname 作为 badge 文案
- 仅有 local agent 时不显示 badge

### 8.3 AgentInfo 类型扩展

```typescript
export interface AgentInfo {
  agent_id: string;
  hostname: string;
  display_name: string;   // 新增
  type: string;           // 新增："local" | "remote"
  state: string;
  mode: string;
  allowed_paths: string[];
  agent_version: string;
  session_count: number;
  process_count: number;
  latency_ms: number;     // 新增
  last_heartbeat: string; // 新增
  connected_at: string;   // 新增
}
```

---

## 9. 实施计划

### 阶段 1：基础设施（后端）

1. 新增 `AgentConfigStore` 服务 — 读写 `agents.json`
2. 扩展 `AgentConnection` 数据模型（display_name, connected_at, last_heartbeat, latency_ms）
3. 创建本机虚拟 agent 对象
4. `GET /api/agents` 返回包含 local agent 的统一列表
5. `PATCH /api/agents/{agent_id}` 改名 API
6. `GET /api/agents/local/processes` 调用本地 process scanner
7. 心跳 ping-pong 机制

### 阶段 2：Agent 管理页面（前端）

1. 新增 `agents.ts` 页面 — 列表 + 详情
2. 导航栏增加"机器"入口
3. 内联改名交互
4. "添加机器" 引导对话框

### 阶段 3：Dashboard 集成

1. 加载 agents 列表获取 display_name 映射
2. 所有 badge 使用 display_name
3. 待命中修正（移除 standbyTimeSessions）
4. 多 agent 时显示全局概览栏

---

## 10. 不做的事（Out of Scope）

- **远程会话恢复**（attach 到远程机器上已有的 Claude 进程）— 需要 cm-agent 扫描 `~/.claude/projects/` 获取 session 列表，后续迭代
- **Agent 权限管理**（谁能连接哪些 agent）— 当前是个人使用，不需要
- **Agent 自动发现**（mDNS 等）— 过度设计
- **Agent 分组/标签** — 当前机器数不超过 5 台，不需要
- **跨机器会话迁移** — 复杂度过高，收益不明确
