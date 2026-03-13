# 安装

## 1. Python 环境

推荐使用 conda 管理 Python 环境：

```bash
# 安装 Miniconda（如果尚未安装）
# https://docs.conda.io/en/latest/miniconda.html

# ClaudeMaster 的 Makefile 会自动创建名为 claudemaster 的 conda 环境
make install
```

??? note "不使用 conda"
    你也可以使用 venv：
    ```bash
    python3.12 -m venv .venv
    source .venv/bin/activate
    pip install -r backend/requirements-dev.txt
    cd frontend && npm install
    ```

## 2. Node.js

ClaudeMaster 前端需要 Node.js 18+：

```bash
# 使用 nvm 安装（推荐）
nvm install 18
nvm use 18

# 或使用系统包管理器
sudo apt install nodejs npm   # Debian/Ubuntu
brew install node              # macOS
```

## 3. Claude Code

ClaudeMaster 依赖本机安装的 Claude Code CLI：

```bash
npm install -g @anthropic-ai/claude-code
```

安装后运行 `claude --version` 验证。

!!! warning "重要"
    ClaudeMaster 读取 `~/.claude/` 目录中的数据文件。请确保 Claude Code 已经至少运行过一次，以生成必要的目录结构。

## 4. 启动 ClaudeMaster

=== "一键启动（推荐）"

    ```bash
    ./start.sh
    ```
    自动安装依赖、构建前端、启动后端。

=== "开发模式"

    ```bash
    make install   # 首次安装
    make dev       # 热重载开发
    ```

=== "cm-agent（远程机器）"

    在远程机器上只需安装 cm-agent：
    ```bash
    pip install websockets
    python agent/cm_agent.py --server ws://your-server:8420 --token secret
    ```

## 5. 验证

启动后访问 `http://localhost:8420`（一键启动）或 `http://localhost:5173`（开发模式），你应该能看到工作台页面。

如果本机有正在运行的 Claude Code 进程，它们会自动出现在工作台上。
