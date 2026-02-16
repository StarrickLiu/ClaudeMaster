# ClaudeMaster

在浏览器中监控和管理本机上运行的所有 Claude Code 实例。

手机、平板、电脑均可访问——随时掌握每个 AI 编程代理的工作状态，阅读对话历史，审查代码变更。

## 功能

- **工作台** — 一目了然查看所有运行中的 Claude Code 进程和最近会话
- **对话查看器** — 完整对话流，Markdown 渲染，思维过程和工具调用可折叠
- **代码变更** — 查看会话项目的 git diff，统一差异视图
- **会话历史** — 跨项目浏览所有历史对话，支持搜索和筛选
- **移动端适配** — 响应式布局，手机浏览器上拇指可达

## 快速启动

### 前置条件

- Python 3.11+（推荐使用 conda）
- Node.js 18+
- 本机已安装 [Claude Code](https://docs.anthropic.com/en/docs/claude-code)

### 安装

```bash
# 创建 Python 环境
conda create -n claudemaster python=3.12 -y
conda run -n claudemaster pip install -r backend/requirements.txt

# 安装前端依赖
cd frontend && npm install && cd ..
```

### 启动开发服务器

```bash
# 终端 1：启动后端（端口 8420）
cd backend && conda run --no-capture-output -n claudemaster \
  python -m uvicorn main:app --host 127.0.0.1 --port 8420 --reload

# 终端 2：启动前端（端口 5173）
cd frontend && npx vite --host
```

打开浏览器访问 `http://localhost:5173`。

### 手机/局域网访问

设置 `AUTH_TOKEN` 环境变量后，后端绑定到 `0.0.0.0`：

```bash
AUTH_TOKEN=your-secret-token \
  conda run --no-capture-output -n claudemaster \
  python -m uvicorn main:app --host 0.0.0.0 --port 8420 --reload
```

手机浏览器打开 `http://<电脑IP>:5173`，首次访问时输入令牌即可。

## 技术栈

| 层 | 技术 |
|---|------|
| 后端 | Python 3.12 · FastAPI · Pydantic |
| 前端 | TypeScript · Lit Web Components · Vite |
| 数据源 | `~/.claude/projects/**/*.jsonl`（Claude Code 对话文件） |
| 进程检测 | `/proc/*/cmdline` 扫描 |

## 项目结构

```
backend/
  config.py              # 全局配置
  main.py                # FastAPI 应用入口
  models/                # Pydantic 数据模型
  routers/               # API 路由（projects/sessions/processes/history/diff）
  services/              # 业务逻辑（JSONL 解析、进程检测、项目扫描）

frontend/
  src/
    pages/               # 页面组件（dashboard/sessions/viewer）
    components/          # 可复用 UI 组件
    utils/               # 工具函数（Markdown 渲染、时间格式化）
    styles/              # CSS 设计变量和响应式布局

docs/
  ARCHITECTURE.md        # 技术架构文档
  PRODUCT.md             # 产品设计文档
```

## 工作原理

ClaudeMaster 不依赖 Claude Code 的任何 API，而是直接读取其本地数据文件：

1. 扫描 `~/.claude/projects/` 发现所有项目和会话
2. 解析 JSONL 对话文件，合并被拆分的 assistant 消息，关联 tool_use 和 tool_result
3. 扫描 `/proc/*/cmdline` 检测运行中的 Claude Code 进程
4. 通过 REST API 向前端提供数据，前端渲染为可读的对话界面

## 文档

- [产品设计文档](docs/PRODUCT.md) — 产品定位、交互流程、防线体系
- [技术架构文档](docs/ARCHITECTURE.md) — 系统架构、数据模型、API 设计
