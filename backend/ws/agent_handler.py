# Agent WebSocket 端点：cm-agent 客户端与服务端的通信通道
from __future__ import annotations

import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from config import AUTH_TOKEN
from services.client_hub import ClientHub

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
    rs = await _client_hub.register_agent(client_id, websocket, reg_msg)

    # 回复注册确认
    await websocket.send_json({
        "type": "registered",
        "session_id": rs.initial_id,
        "name": rs.name,
    })

    logger.info("agent WebSocket 已建立: client_id=%s, name=%s", client_id[:8], rs.name)

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                logger.warning("agent 发送无效 JSON: %s", raw[:200])
                continue

            msg_type = msg.get("type")

            if msg_type == "event":
                # Claude stdout 事件转发
                event = msg.get("event")
                if event and isinstance(event, dict):
                    await _client_hub.handle_agent_event(rs, event)

            elif msg_type == "agent_status":
                # agent 状态报告（如 Claude 退出）
                await _client_hub.handle_agent_status(rs, msg)

            else:
                logger.debug("agent 未知消息类型: %s", msg_type)

    except WebSocketDisconnect:
        logger.info("agent WebSocket 断开: client_id=%s", client_id[:8])
    except Exception:
        logger.error("agent WebSocket 异常", exc_info=True)
    finally:
        await _client_hub.unregister_agent(client_id)
