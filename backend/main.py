# FastAPI 应用入口：CORS、认证中间件、路由挂载
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from pathlib import Path

from config import AUTH_TOKEN
from routers import projects, sessions, processes, history, diff

app = FastAPI(title="ClaudeMaster", version="0.1.0", description="Claude Code Web 管理平台")

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

# 生产模式下服务前端静态文件
frontend_dist = Path(__file__).parent.parent / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")
