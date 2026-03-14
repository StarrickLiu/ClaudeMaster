# 开发指南

## 环境搭建

```bash
# 创建 conda 环境并安装所有依赖
make install

# 启动开发模式（后端热重载 + 前端 HMR）
make dev
```

## 常用命令

| 命令 | 说明 |
|------|------|
| `make install` | 安装所有依赖（Python + Node） |
| `make dev` | 启动开发模式：后端 :8420，前端 :5173 |
| `make lint` | 运行代码检查（ruff + eslint） |
| `make test` | 运行全部测试 |
| `make test-backend` | 仅后端测试（pytest） |
| `make test-frontend` | 仅前端测试（vitest） |
| `make https` | 启动 HTTPS 模式（需要 Caddy） |
| `make docs-dev` | 启动文档站开发预览 :8430 |

## 目录结构

```
backend/
  routers/     ← FastAPI 路由（每个资源一个文件）
  services/    ← 业务逻辑（每个关注点一个文件）
  models/      ← Pydantic 数据模型（chat.py, agent.py, diff.py, ...）
  ws/          ← WebSocket 端点（handler.py, agent_handler.py）

frontend/src/
  pages/       ← 页面级 Lit 组件（dashboard, viewer, agents, ...）
  components/  ← 可复用 UI 组件
  services/    ← WebSocket 客户端
  styles/      ← CSS 设计变量 + 共享 Lit CSS（shared.ts）
  utils/       ← 工具函数（format.ts, theme.ts, constants.ts, ...）

agent/         ← cm-agent 远程守护进程 + requirements.txt
site-docs/     ← 产品文档站（MkDocs Material）
ruff.toml      ← Python 代码检查配置（ruff）
```

## 开发工作流

1. 修改代码后，后端和前端都会自动热重载
2. 运行 `make lint` 检查代码风格
3. 运行 `make test` 确保测试通过
4. Git 提交信息使用**中文**

## 关键设计决策

- 会话数据解析自 `~/.claude/projects/**/*.jsonl`
- 进程检测扫描 `/proc/*/cmdline`
- WebSocket `/ws/chat/{session_id}` 提供实时交互
- 前端使用 hash 路由（`#/dashboard`、`#/viewer/:project/:id`）
- 时间戳统一 UTC 存储，前端渲染为本地时间
- Broker 会话有[双 ID 体系](../architecture/data-model.md#id)
- Viewer 打开时不自动连接 broker，需手动接入
