# Agent WebSocket 端点：cm-agent 客户端与服务端的通信通道
from __future__ import annotations

import asyncio
import json
import logging
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from config import AUTH_TOKEN
from services.client_hub import ClientHub, AgentConnection, RemoteSession

logger = logging.getLogger(__name__)
router = APIRouter()

# 模块级引用，在 main.py 中注入
_client_hub: ClientHub | None = None


def init_agent_handler(client_hub: ClientHub) -> None:
    """由 main.py 调用，注入 ClientHub 实例。"""
    global _client_hub
    _client_hub = client_hub


@router.websocket("/ws/agent/{client_id}")
async def agent_ws(websocket: WebSocket, client_id: str) -> None:
    """cm-agent 客户端的 WebSocket 连接端点。"""
    if _client_hub is None:
        raise RuntimeError("ClientHub 未初始化")

    await websocket.accept()

    # 鉴权
    if AUTH_TOKEN:
        token = websocket.query_params.get("token", "")
        if token != AUTH_TOKEN:
            await websocket.send_json({"type": "error", "message": "未授权"})
            await websocket.close(code=4001, reason="未授权")
            return

    # 等待 register 消息
    try:
        raw = await websocket.receive_text()
        reg_msg = json.loads(raw)
    except Exception as e:
        logger.error("agent 注册消息解析失败: %s", e)
        await websocket.send_json({"type": "error", "message": "无效的注册消息"})
        await websocket.close(code=4000, reason="无效注册")
        return

    if reg_msg.get("type") != "register":
        await websocket.send_json({"type": "error", "message": "首条消息必须是 register"})
        await websocket.close(code=4000, reason="未注册")
        return

    # 注册 agent
    result = await _client_hub.register_agent(client_id, websocket, reg_msg)

    # 根据返回类型发送不同的确认
    if isinstance(result, AgentConnection):
        # daemon 模式：返回 agent 信息
        await websocket.send_json({
            "type": "registered",
            "agent_id": result.agent_id,
            "name": result.hostname,
            "mode": "daemon",
        })
        logger.info("daemon agent WebSocket 已建立: agent_id=%s, hostname=%s", client_id[:8], result.hostname)
        agent = result
    elif isinstance(result, RemoteSession):
        # oneshot 模式（向后兼容）：返回 session 信息
        await websocket.send_json({
            "type": "registered",
            "session_id": result.initial_id,
            "name": result.name,
        })
        logger.info("oneshot agent WebSocket 已建立: client_id=%s, name=%s", client_id[:8], result.name)
        agent = _client_hub.get_agent(client_id)
    else:
        await websocket.send_json({"type": "error", "message": "注册失败"})
        await websocket.close(code=4000, reason="注册失败")
        return

    async def _ping_loop(ws: WebSocket, interval: float = 30.0) -> None:
        """定期向 agent 发送 ping 消息以检测延迟和连接状态。"""
        try:
            while True:
                await asyncio.sleep(interval)
                await ws.send_json({"type": "ping", "ts": int(time.time() * 1000)})
        except Exception:
            pass

    ping_task = asyncio.create_task(_ping_loop(websocket))

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                logger.warning("agent 发送无效 JSON: %s", raw[:200])
                continue

            msg_type = msg.get("type")
            session_id = msg.get("session_id")

            if msg_type == "event":
                # Claude stdout 事件转发
                event = msg.get("event")
                if event and isinstance(event, dict):
                    if agent:
                        await _client_hub.handle_agent_event(
                            agent, event, session_id=session_id,
                        )

            elif msg_type == "agent_status":
                # agent 状态报告（如 Claude 退出）
                if agent:
                    await _client_hub.handle_agent_status(
                        agent, msg, session_id=session_id,
                    )

            elif msg_type == "session_started":
                # daemon agent 报告新会话已启动
                if agent:
                    await _client_hub.handle_session_started(agent, msg)

            elif msg_type == "session_start_failed":
                # daemon agent 报告会话启动失败
                if agent:
                    await _client_hub.handle_session_start_failed(agent, msg)

            elif msg_type == "processes":
                # daemon agent 上报进程列表
                if agent:
                    await _client_hub.handle_processes(agent, msg)

            elif msg_type == "pong":
                # agent 的 pong 响应
                if agent:
                    await _client_hub.handle_pong(agent, msg)

            elif msg_type == "session_detail":
                # agent 返回的完整会话内容
                if agent:
                    await _client_hub.handle_session_detail(agent, msg)

            else:
                logger.debug("agent 未知消息类型: %s", msg_type)

    except WebSocketDisconnect:
        logger.info("agent WebSocket 断开: client_id=%s", client_id[:8])
    except Exception:
        logger.error("agent WebSocket 异常", exc_info=True)
    finally:
        ping_task.cancel()
        await _client_hub.unregister_agent(client_id)
