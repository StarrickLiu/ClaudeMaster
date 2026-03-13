# FastAPI 应用入口：CORS、认证中间件、路由挂载、生命周期管理
import logging
import sys
from contextlib import asynccontextmanager
from collections.abc import AsyncGenerator
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path

# --- 日志配置：同时输出到 stdout 和滚动日志文件 ---
_LOG_DIR = Path(__file__).resolve().parent.parent / "logs"
_LOG_DIR.mkdir(exist_ok=True)

_log_fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")

# stdout handler
_stream_handler = logging.StreamHandler(sys.stdout)
_stream_handler.setFormatter(_log_fmt)

# 按启动时间命名的日志文件，单文件最大 20 MB，保留最近 30 个
_log_filename = _LOG_DIR / f"cm_{datetime.now(timezone.utc).strftime('%Y-%m-%d_%H-%M-%S')}.log"
_file_handler = RotatingFileHandler(
    _log_filename,
    maxBytes=20 * 1024 * 1024,
    backupCount=30,
    encoding="utf-8",
)
_file_handler.setFormatter(_log_fmt)

logging.basicConfig(
    level=logging.INFO,
    handlers=[_stream_handler, _file_handler],
)

from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from config import AUTH_TOKEN
from routers import projects, sessions, processes, history, diff, chat, usage
from ws.handler import router as ws_router, init_chat_handler
from ws.agent_handler import router as agent_ws_router, init_agent_handler
from services.claude_broker import broker
from services.client_hub import ClientHub
from services.session_registry import SessionRegistry

# 实例化多客户端架构组件
client_hub = ClientHub()
registry = SessionRegistry(broker, client_hub)

# 注入依赖到各模块
init_chat_handler(registry)
init_agent_handler(client_hub)
chat.init_chat_router(registry)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
    yield
    await broker.shutdown()


app = FastAPI(
    title="ClaudeMaster",
    version="0.3.0",
    description="Claude Code Web 管理平台",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


if AUTH_TOKEN:
    class AuthMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request: Request, call_next):  # type: ignore[override]
            if request.url.path.startswith("/api/"):
                token = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
                if token != AUTH_TOKEN:
                    raise HTTPException(status_code=401, detail="未授权")
            return await call_next(request)

    app.add_middleware(AuthMiddleware)

app.include_router(projects.router, prefix="/api")
app.include_router(sessions.router, prefix="/api")
app.include_router(processes.router, prefix="/api")
app.include_router(history.router, prefix="/api")
app.include_router(diff.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(usage.router, prefix="/api")
app.include_router(ws_router)
app.include_router(agent_ws_router)

# 生产模式下服务前端静态文件
frontend_dist = Path(__file__).parent.parent / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")
