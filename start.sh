#!/usr/bin/env bash
# ClaudeMaster 一键启动脚本：构建前端 + 启动后端（单进程，端口 8420）
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
CONDA_ENV="claudemaster"
PORT="${PORT:-8420}"

# 颜色
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}[ClaudeMaster]${NC} 启动中..."

# 检查 conda 环境
if ! conda env list 2>/dev/null | grep -q "^${CONDA_ENV} "; then
    echo -e "${CYAN}[ClaudeMaster]${NC} 首次运行，安装依赖..."
    conda create -n "$CONDA_ENV" python=3.12 -y
    conda run --no-capture-output -n "$CONDA_ENV" pip install -r "$DIR/backend/requirements.txt"
    cd "$DIR/frontend" && npm install
fi

# 构建前端（仅当源码比 dist 新时）
DIST="$DIR/frontend/dist/index.html"
NEEDS_BUILD=0
if [ ! -f "$DIST" ]; then
    NEEDS_BUILD=1
else
    # 检查是否有比 dist 更新的源文件
    NEWEST_SRC=$(find "$DIR/frontend/src" "$DIR/frontend/index.html" -newer "$DIST" 2>/dev/null | head -1)
    [ -n "$NEWEST_SRC" ] && NEEDS_BUILD=1
fi

if [ "$NEEDS_BUILD" = "1" ]; then
    echo -e "${CYAN}[ClaudeMaster]${NC} 构建前端..."
    cd "$DIR/frontend" && npx vite build --logLevel warn
fi

# 启动后端（会自动服务前端静态文件）
HOST="0.0.0.0"
LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}')

if [ -n "$AUTH_TOKEN" ]; then
    echo -e "${GREEN}[ClaudeMaster]${NC} 已启用认证"
else
    echo -e "${GREEN}[ClaudeMaster]${NC} 未设置 AUTH_TOKEN，局域网内无需密码即可访问"
fi

echo -e "${GREEN}[ClaudeMaster]${NC} 本机访问 → http://localhost:${PORT}"
[ -n "$LAN_IP" ] && echo -e "${GREEN}[ClaudeMaster]${NC} 局域网访问 → http://${LAN_IP}:${PORT}"
echo ""

# 将 nvm 最新 node 的 bin 目录加入 PATH，确保 claude 对后端子进程可见
NVM_ROOT="$HOME/.nvm/versions/node"
if [ -d "$NVM_ROOT" ]; then
    NVM_LATEST_BIN="$NVM_ROOT/$(ls "$NVM_ROOT" | sort -V | tail -1)/bin"
    export PATH="$NVM_LATEST_BIN:$PATH"
    export CLAUDE_BIN="$NVM_LATEST_BIN/claude"
fi

cd "$DIR/backend"
exec conda run --no-capture-output -n "$CONDA_ENV" \
    python -m uvicorn main:app --host "$HOST" --port "$PORT"
