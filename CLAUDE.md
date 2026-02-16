# ClaudeMaster 开发指南

## 项目概述
ClaudeMaster 是一个个人使用的 Web 端 Claude Code CLI 管理平台。
后端：Python 3.11+ / FastAPI。前端：TypeScript / Lit Web Components / Vite。

## 架构文档
详见 docs/ARCHITECTURE.md。

## 开发命令
- `make install`  — 安装所有依赖（Python + Node）
- `make dev`      — 启动开发模式：后端 :8420，前端 :5173
- `make lint`     — 运行代码检查（ruff + eslint）
- `make test`     — 运行全部测试

## 代码规范
- Python：snake_case，所有函数加类型标注，数据结构使用 Pydantic
- TypeScript：camelCase，严格模式，Lit 装饰器定义组件
- 每个源文件开头写一行注释说明用途
- API 端点在装饰器中写 summary 和 description
- Git 提交信息用中文

## 目录结构
- backend/routers/   — FastAPI 路由（每个资源一个文件）
- backend/services/  — 业务逻辑（每个关注点一个文件）
- backend/models/    — Pydantic 数据模型
- frontend/src/pages/      — 页面级 Lit 组件
- frontend/src/components/ — 可复用 UI 组件

## 测试
- 后端：pytest + httpx AsyncClient
- 前端：Vitest
- 测试文件与源码同目录：foo.py → foo_test.py，foo.ts → foo.test.ts

## 关键设计决策
- 会话数据解析自 ~/.claude/projects/**/*.jsonl（每行一个 JSON 对象）
- 进程检测扫描 /proc/*/cmdline 中包含 "claude-code/cli.js" 的条目
- WebSocket /ws 提供实时更新（文件监听 → 事件总线 → WebSocket）
- 前端使用 hash 路由（#/dashboard、#/sessions、#/viewer/:id）
- 时间戳统一使用 UTC 存储，前端渲染为本地时间
- 后端默认绑定 127.0.0.1；设置 AUTH_TOKEN 环境变量后绑定 0.0.0.0 以支持局域网访问
