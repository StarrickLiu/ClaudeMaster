# ClaudeMaster

在浏览器中监控、管理和交互本机及远程机器上运行的所有 Claude Code 实例。

手机、平板、电脑均可访问——随时掌握每个 AI 编程代理的工作状态，阅读对话历史，审查代码变更，甚至直接与 Claude 对话。通过 cm-agent 将任意机器上的 Claude Code 接入统一管理。

## 功能

- **工作台** — 一目了然查看活跃进程、待命会话（24h 内）和最近会话
- **交互式对话** — 在浏览器中直接与 Claude Code 对话，支持恢复历史会话
- **对话查看器** — 完整对话流，Markdown 渲染，思维过程和工具调用可折叠
- **实时监控** — WebSocket 实时推送 Claude 输出，工具调用活动日志
- **权限审批** — 远程审批 Claude 的工具使用请求（文件写入、命令执行等）
- **代码变更** — 查看会话项目的 git diff 和提交历史
- **会话管理** — 自动命名（Docker 风格），支持内联重命名
- **远程接入** — 通过 cm-agent 将任意机器上的 Claude Code 接入管理，浏览器无感连接
- **HTTPS 支持** — 通过 Caddy 反向代理，自签名证书，适合局域网/外网访问
- **移动端适配** — 响应式布局，手机浏览器上拇指可达

## 快速启动

### 前置条件

- Python 3.11+（推荐使用 conda）
- Node.js 18+
- 本机已安装 [Claude Code](https://docs.anthropic.com/en/docs/claude-code)

### 一键启动

```bash
git clone https://github.com/StarrickLiu/ClaudeMaster.git
cd ClaudeMaster
./start.sh
```

`start.sh` 会自动安装依赖、构建前端、启动后端（端口 8420）。

### 开发模式

```bash
make install   # 首次：创建 conda 环境 + 安装依赖
make dev       # 启动后端 :8420（热重载）+ 前端 :5173（HMR）
```

打开浏览器访问 `http://localhost:5173`。

### 手机/局域网访问

设置 `AUTH_TOKEN` 环境变量启用认证，后端自动绑定 `0.0.0.0`：

```bash
AUTH_TOKEN=your-secret-token ./start.sh
```

手机浏览器打开 `http://<电脑IP>:8420`，首次访问时输入令牌即可。

### HTTPS 访问（推荐用于外网）

需要安装 [Caddy](https://caddyserver.com/)：

```bash
AUTH_TOKEN=your-secret-token make https
```

一条命令同时启动后端（:8421 内部）和 Caddy HTTPS 反向代理（:8420 对外）。
端口映射只需转发 8420，手机浏览器访问 `https://<IP>:8420`。

可通过环境变量配置监听端口和后端地址：

```bash
CM_LISTEN=:443 CM_BACKEND=127.0.0.1:8421 AUTH_TOKEN=your-secret-token make https
```

### 远程接入（cm-agent）

在任意远程机器上运行 cm-agent，即可将该机器的 Claude Code 会话接入 ClaudeMaster 统一管理。

**远程机器上安装：**

```bash
# 只需要 agent 脚本和 websockets 库
pip install websockets
curl -O https://raw.githubusercontent.com/StarrickLiu/ClaudeMaster/main/agent/cm_agent.py
chmod +x cm_agent.py
```

**启动 agent：**

```bash
# 基本用法：连接服务端并在指定项目目录启动 Claude
./cm_agent.py --server wss://<服务端IP>:8420 --token your-secret-token --project /path/to/project

# 恢复已有会话
./cm_agent.py --server wss://<服务端IP>:8420 --token your-secret-token --project /path/to/project -- --resume <session-id>

# 所有 -- 之后的参数透传给 Claude CLI
./cm_agent.py --server wss://my-server:8420 --token secret --project . -- --model sonnet --allowedTools "Bash,Read"
```

**参数说明：**

| 参数 | 说明 |
|------|------|
| `--server` | ClaudeMaster 服务端 WebSocket 地址（`ws://` 或 `wss://`） |
| `--token` | 认证令牌（与服务端 `AUTH_TOKEN` 一致） |
| `--project` | Claude Code 工作目录（默认当前目录） |
| `-- ...` | 透传给 Claude CLI 的额外参数 |

连接成功后，远程会话会自动出现在工作台上，显示主机名标识，操作方式与本地会话完全一致。agent 支持断线自动重连（最长等待 30 秒）。

## 技术栈

| 层 | 技术 |
|---|------|
| 后端 | Python 3.12 · FastAPI · Pydantic |
| 前端 | TypeScript · Lit Web Components · Vite |
| 数据源 | `~/.claude/projects/**/*.jsonl`（Claude Code 对话文件） |
| 进程管理 | Broker 模式：Claude CLI 子进程 + stream-json 协议 |
| 远程接入 | cm-agent sidecar + WebSocket |
| 反向代理 | Caddy（可选，HTTPS + WebSocket） |

## 项目结构

```
agent/
  cm_agent.py              # 远程 sidecar 客户端

backend/
  main.py                # FastAPI 应用入口
  config.py              # 全局配置
  models/                # Pydantic 数据模型
  routers/               # API 路由（sessions/chat/processes/history/diff）
  services/              # 业务逻辑
    claude_broker.py     # Claude Code 子进程管理（broker 模式）
    client_hub.py        # 远程 agent 连接管理
    session_registry.py  # 统一会话索引（本地 + 远程）
    session_store.py     # JSONL 会话解析与缓存
    session_name_store.py # 会话名称持久化
    name_generator.py    # Docker 风格随机名称生成器
    process_manager.py   # 进程检测（/proc 扫描）
  ws/
    handler.py           # WebSocket 双向桥梁
    agent_handler.py     # Agent WebSocket 端点

frontend/src/
  pages/                 # 页面组件（dashboard/viewer/docs）
  components/            # 可复用 UI（chat-input/session-header/message-bubble...）
  services/              # 客户端服务（chat-client WebSocket 客户端）
  styles/                # CSS 设计变量和响应式布局
  utils/                 # 工具函数（Markdown 渲染、时间格式化）
```

## 工作原理

ClaudeMaster 既能读取 Claude Code 的本地数据文件，也能通过子进程直接控制 Claude CLI：

**只读模式**（查看历史会话）：
1. 扫描 `~/.claude/projects/` 发现所有项目和会话
2. 解析 JSONL 对话文件，合并被拆分的 assistant 消息，关联 tool_use 和 tool_result
3. 扫描 `/proc/*/cmdline` 检测运行中的 Claude Code 进程

**交互模式**（Broker 架构）：
1. 通过 `POST /api/chat/start` 启动 Claude CLI 子进程（`claude -p --input-format stream-json --output-format stream-json`）
2. Broker 管理子进程的 stdin/stdout，解析 stream-json 事件
3. 前端通过 `WebSocket /ws/chat/{session_id}` 与 Broker 双向通信
4. 支持发送消息、审批工具权限、中断执行

**远程模式**（cm-agent 架构）：
1. 远程机器运行 cm-agent，启动 Claude CLI 并通过 WebSocket 接入服务端
2. 服务端 SessionRegistry 统一管理本地和远程会话
3. 浏览器通过同一个 `/ws/chat/{id}` 无感连接，无需区分来源

**会话 ID 体系**：
- `session_id`（initial_id）：稳定标识，用于 URL、WebSocket 连接、Broker 查找
- `claude_session_id`：Claude 分配的真实 ID，用于 JSONL 文件加载

## 测试

```bash
make test            # 运行全部测试
make test-backend    # 仅后端（pytest）
make test-frontend   # 仅前端（vitest）
```

## 文档

- [产品设计文档](docs/PRODUCT.md) — 产品定位、交互流程
- [技术架构文档](docs/ARCHITECTURE.md) — 系统架构、数据模型、API 设计
