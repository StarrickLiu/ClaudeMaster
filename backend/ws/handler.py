# WebSocket 端点：浏览器与 Claude Code 子进程的实时桥梁
from __future__ import annotations

import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Any

from config import AUTH_TOKEN
from services.claude_broker import broker

logger = logging.getLogger(__name__)
router = APIRouter()


@router.websocket("/ws/chat/{session_id}")
async def chat_ws(websocket: WebSocket, session_id: str) -> None:
    """单个 Claude 会话的 WebSocket 双向通道。"""
    await websocket.accept()

    # 鉴权：从 query param 读取 token
    if AUTH_TOKEN:
        token = websocket.query_params.get("token", "")
        if token != AUTH_TOKEN:
            await websocket.send_json({"type": "error", "message": "未授权"})
            await websocket.close(code=4001, reason="未授权")
            return

    cs = broker.get_session(session_id)
    if not cs:
        await websocket.send_json({"type": "error", "message": f"会话 {session_id} 不存在，请先通过 /api/chat/start 启动"})
        await websocket.close(code=4004, reason="会话不存在")
        return

    # 订阅 Claude stdout 事件，转发到 WebSocket
    async def on_event(event: dict[str, Any]) -> None:
        try:
            await websocket.send_json(event)
        except Exception:
            pass

    sub_id = cs.subscribe(on_event)

    try:
        # 发送当前状态
        await websocket.send_json({
            "type": "_state",
            "session_id": cs.session_id,
            "state": cs.state,
        })

        # 如果有待审批请求，回放给新连接的客户端
        if cs.pending_control_request:
            await websocket.send_json(cs.pending_control_request)

        # 持续读取浏览器消息
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_json({"type": "error", "message": "无效的 JSON"})
                continue

            msg_type = msg.get("type")

            # 用 cs.session_id（实时的）而不是 path 参数中的 session_id
            sid = cs.session_id

            if msg_type == "user_message":
                text = msg.get("text", "").strip()
                if text:
                    try:
                        await broker.send_message(sid, text)
                    except ValueError as e:
                        await websocket.send_json({"type": "error", "message": str(e)})

            elif msg_type == "control_response":
                logger.info("[PERM] browser -> control_response: %s", json.dumps(msg, ensure_ascii=False)[:400])
                try:
                    await broker.send_control_response(
                        sid,
                        msg["request_id"],
                        msg.get("behavior", "allow"),
                        message=msg.get("message"),
                        updated_input=msg.get("updated_input"),
                    )
                except ValueError as e:
                    await websocket.send_json({"type": "error", "message": str(e)})

            elif msg_type == "interrupt":
                try:
                    await broker.send_interrupt(sid)
                except ValueError as e:
                    await websocket.send_json({"type": "error", "message": str(e)})

            else:
                await websocket.send_json({"type": "error", "message": f"未知消息类型: {msg_type}"})

    except WebSocketDisconnect:
        logger.debug("WebSocket 断开: session=%s", session_id[:8])
    except Exception:
        logger.debug("WebSocket 异常", exc_info=True)
    finally:
        cs.unsubscribe(sub_id)
