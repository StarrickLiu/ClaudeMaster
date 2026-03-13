# ClaudeMaster

**在浏览器中监控、管理和交互本机上运行的所有 Claude Code 实例。**

手机、平板、电脑均可访问——随时掌握每个 AI 编程代理的工作状态，阅读对话历史，审查代码变更，甚至直接与 Claude 对话。

---

## 功能亮点

| | 功能 | 说明 |
|:---:|------|------|
| :material-monitor-dashboard: | **工作台** | 一目了然查看活跃进程、待命会话和最近对话历史 |
| :material-chat-processing: | **交互式对话** | 在浏览器中直接与 Claude Code 对话，支持恢复历史会话 |
| :material-file-document-outline: | **对话查看器** | 完整对话流，Markdown 渲染，思维过程和工具调用可折叠 |
| :material-access-point: | **实时监控** | WebSocket 实时推送 Claude 输出，工具调用活动日志 |
| :material-shield-check: | **权限审批** | 远程审批 Claude 的工具使用请求（文件写入、命令执行等） |
| :material-laptop: | **远程接入** | 通过 cm-agent 将任意机器上的 Claude Code 接入 ClaudeMaster |
| :material-source-branch: | **代码变更** | 查看会话项目的 git diff 和提交历史 |
| :material-tag-text: | **会话管理** | 自动命名（Docker 风格），支持内联重命名 |
| :material-lock: | **HTTPS 支持** | 通过 Caddy 反向代理，自签名证书，适合局域网/外网 |
| :material-cellphone: | **移动端适配** | 响应式布局，手机浏览器上拇指可达 |
| :material-chart-bar: | **配额显示** | Token 用量统计与配额监控 |

## 技术栈

| 层 | 技术 |
|---|------|
| 后端 | Python 3.12 · FastAPI · Pydantic |
| 前端 | TypeScript · Lit Web Components · Vite |
| 数据源 | `~/.claude/projects/**/*.jsonl`（Claude Code 对话文件） |
| 进程管理 | Broker 模式：Claude CLI 子进程 + stream-json 协议 |
| 远程接入 | cm-agent sidecar + WebSocket |
| 反向代理 | Caddy（可选，HTTPS + WebSocket） |

## 快速体验

```bash
git clone <repo> ClaudeMaster
cd ClaudeMaster
./start.sh
```

打开浏览器访问 `http://localhost:8420`，即可开始使用。

详细安装步骤请参阅 [快速开始](getting-started/index.md)。
