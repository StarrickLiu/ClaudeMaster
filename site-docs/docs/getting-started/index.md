# 快速开始

本页帮助你在 5 分钟内启动 ClaudeMaster。

## 前置条件

- Python 3.11+（推荐使用 [conda](https://docs.conda.io/)）
- Node.js 18+
- 本机已安装 [Claude Code](https://docs.anthropic.com/en/docs/claude-code)

## 一键启动

```bash
git clone <repo> ClaudeMaster
cd ClaudeMaster
./start.sh
```

`start.sh` 会自动安装依赖、构建前端、启动后端（端口 8420）。

打开浏览器访问 `http://localhost:8420`。

## 开发模式

如果你想修改代码，使用开发模式获得热重载体验：

```bash
make install   # 首次：创建 conda 环境 + 安装依赖
make dev       # 启动后端 :8420（热重载）+ 前端 :5173（HMR）
```

打开浏览器访问 `http://localhost:5173`。

## 下一步

- [安装详解](installation.md) — 逐步安装 Python、Node.js、Claude Code
- [配置说明](configuration.md) — AUTH_TOKEN、HTTPS、端口等配置项
- [工作台使用](../guide/dashboard.md) — 了解工作台界面
