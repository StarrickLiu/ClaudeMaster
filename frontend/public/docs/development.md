# 开发指南

## 部署模式

### 开发模式

```bash
make dev  # 后端 :8420 (uvicorn --reload) + 前端 :5173 (Vite HMR)
```

前端通过 Vite proxy 转发 API 请求到后端。代码修改后自动热更新。

### 生产模式

```bash
./start.sh  # 构建前端 → 后端服务静态文件 → 单端口 :8420
```

后端使用 FastAPI `StaticFiles` 挂载 `frontend/dist/`，所有请求走一个端口。前端源码修改后需重新 `npx vite build`。

### 局域网访问

设置 `AUTH_TOKEN` 环境变量后，后端绑定 `0.0.0.0`，手机等设备可通过局域网 IP 访问。首次访问时输入 token 即可。

## 设计原则

1. **清晰优于精巧** — 每个文件职责单一，数据流显式
2. **模块隔离** — 每个模块可独立理解、修改和测试
3. **类型化接口** — Python Pydantic + TypeScript 严格模式
4. **约定优于配置** — Python `snake_case`、TypeScript `camelCase`
5. **上下文自包含** — 每个源文件开头注释说明用途
6. **移动优先** — 响应式布局，手机和桌面均可用

## 代码规范

- **Python**：snake_case，所有函数加类型标注，数据结构使用 Pydantic
- **TypeScript**：camelCase，严格模式，Lit 装饰器定义组件
- **测试**：后端 pytest + httpx，前端 Vitest，测试文件与源码同目录
- **Git**：提交信息用中文
- **API**：端点装饰器写 summary 和 description
- **文件**：每个源文件开头一行注释说明用途

## 常用命令

| 命令 | 说明 |
|------|------|
| `make install` | 安装所有依赖（Python + Node） |
| `make dev` | 启动开发模式 |
| `make lint` | 运行代码检查（ruff + eslint） |
| `make test` | 运行全部测试 |
| `make test-backend` | 仅后端测试 |
| `make test-frontend` | 仅前端测试 |

## 工程配置

| 工具 | 配置文件 | 说明 |
|------|---------|------|
| Ruff | `ruff.toml` | Python 代码检查（line-length=120, py312） |
| ESLint | `frontend/eslint.config.mjs` | TypeScript 代码检查（flat config） |
| TypeScript | `frontend/tsconfig.json` | 严格模式，ES2022 |
| Vite | `frontend/vite.config.ts` | 开发代理、构建输出 |
| pytest | `backend/pytest.ini` | 测试配置 |

## 更新日志

### 2026-03-14
- 全面代码重构：62 个问题修复
- 提取 BaseSession 基类，统一本地/远程会话接口
- Pydantic 模型从 router 迁移到 models/ 目录
- 前端提取共享工具（format.ts, theme.ts, constants.ts, shared.ts）
- API 请求函数合并为统一 _fetch 基方法 + 401 防并发弹窗
- diff.py N+1 性能修复（单条 git log --stat）
- 新增 ruff.toml + eslint.config.mjs 工程配置
- 架构文档全面更新

### 2026-02-19
- 初版产品文档
- 工作台区块划分规则明确：工作中仅显示 agent 正在执行的会话，待命中显示空闲进程
- 徽章规则：最近会话和待命中不显示"运行中"
- 文档页面拆分为多页导航结构
