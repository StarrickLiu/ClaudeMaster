// Claude 交互式会话 WebSocket 客户端
export type ChatState =
  | "connecting"
  | "connected"
  | "starting"
  | "streaming"
  | "waiting_permission"
  | "idle"
  | "closed"
  | "error";

export interface PermissionRequest {
  requestId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface ResultStats {
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
}

export interface ToolActivity {
  toolName: string;
  input: Record<string, unknown>;
  complete: boolean;   // false = 刚开始（input 还在流式接收中），true = 参数完整
  timestamp: number;
}

/** 会话心跳信息（远程 agent 专用） */
export interface HeartbeatInfo {
  /** 最后一次收到心跳的本地时间戳（ms） */
  lastTs: number;
  /** 是否超时（超过 10 秒未收到心跳） */
  stale: boolean;
}

export interface ChatEventMap {
  "state-change": ChatState;
  "text-delta": string;
  "thinking-delta": string;
  "assistant-message": Record<string, unknown>;
  "permission-request": PermissionRequest;
  "tool-activity": ToolActivity;
  "result": Record<string, unknown>;
  "result-stats": ResultStats;
  "session-id": string;
  "status": string | null;
  "error": string;
  "closed": void;
  "heartbeat": HeartbeatInfo;
}

type Listener<T> = (data: T) => void;

export class ChatClient {
  private ws: WebSocket | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private listeners = new Map<string, Set<Listener<any>>>();
  private _state: ChatState = "closed";
  private _pending: string[] = [];
  /** 按 stream block index 追踪正在接收 input_json_delta 的工具块 */
  private _activeToolBlocks = new Map<number, { name: string; partialJson: string }>();
  /** starting 状态超时计时器：8s 后自动升级为 idle */
  private _startingTimer: ReturnType<typeof setTimeout> | null = null;
  /** 会话心跳追踪 */
  private _lastHeartbeat = 0;
  private _heartbeatChecker: ReturnType<typeof setInterval> | null = null;
  private _heartbeatStale = false;

  get state(): ChatState {
    return this._state;
  }

  constructor(private sessionId: string) {}

  connect(): void {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const host = location.host;
    let url = `${proto}//${host}/ws/chat/${this.sessionId}`;

    const token = localStorage.getItem("cm_auth_token");
    if (token) url += `?token=${encodeURIComponent(token)}`;

    this._setState("connecting");
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this._setState("connected");
      // 发送缓冲的消息
      this._flushPending();
      // 启动心跳检测定时器
      this._startHeartbeatChecker();
    };

    this.ws.onmessage = (ev) => {
      try {
        const event = JSON.parse(ev.data);
        this._handleEvent(event);
      } catch {
        // 忽略无法解析的消息
      }
    };

    this.ws.onclose = () => {
      this._setState("closed");
      this.emit("closed", undefined as never);
    };

    this.ws.onerror = () => {
      this.ws?.close();
      this._setState("error");
      this.emit("error", "WebSocket 连接失败");
    };
  }

  sendMessage(text: string): void {
    const payload = JSON.stringify({ type: "user_message", text });
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(payload);
    } else {
      // WS 还未就绪时缓冲
      this._pending.push(payload);
    }
  }

  approvePermission(requestId: string, toolInput?: Record<string, unknown>): void {
    const msg: Record<string, unknown> = {
      type: "control_response",
      request_id: requestId,
      behavior: "allow",
    };
    // 按 SDK 文档：approve 时应将原始 input 作为 updatedInput 回传
    if (toolInput !== undefined) {
      msg.updated_input = toolInput;
    }
    this._send(msg);
  }

  denyPermission(requestId: string): void {
    this._send({
      type: "control_response",
      request_id: requestId,
      behavior: "deny",
      message: "用户拒绝了此操作",
    });
  }

  answerQuestion(requestId: string, updatedInput: Record<string, unknown>): void {
    this._send({
      type: "control_response",
      request_id: requestId,
      behavior: "allow",
      updated_input: updatedInput,
    });
  }

  interrupt(): void {
    this._send({ type: "interrupt" });
  }

  disconnect(): void {
    if (this._startingTimer) {
      clearTimeout(this._startingTimer);
      this._startingTimer = null;
    }
    this._stopHeartbeatChecker();
    this.ws?.close();
    this.ws = null;
    this._pending = [];
    this._setState("closed");
  }

  on<K extends keyof ChatEventMap>(event: K, listener: Listener<ChatEventMap[K]>): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
  }

  off<K extends keyof ChatEventMap>(event: K, listener: Listener<ChatEventMap[K]>): void {
    this.listeners.get(event)?.delete(listener);
  }

  private emit<K extends keyof ChatEventMap>(event: K, data: ChatEventMap[K]): void {
    this.listeners.get(event)?.forEach((fn) => fn(data));
  }

  private _send(data: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private _flushPending(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    for (const payload of this._pending) {
      this.ws.send(payload);
    }
    this._pending = [];
  }

  private _setState(s: ChatState): void {
    this._state = s;
    this.emit("state-change", s);
    // 进入 starting 时启动兜底计时器：8s 后若仍是 starting 则视为 idle
    if (this._startingTimer) {
      clearTimeout(this._startingTimer);
      this._startingTimer = null;
    }
    if (s === "starting") {
      this._startingTimer = setTimeout(() => {
        if (this._state === "starting") {
          this._setState("idle");
        }
      }, 8000);
    }
  }

  private _handleEvent(event: Record<string, unknown>): void {
    const type = event["type"] as string;

    switch (type) {
      case "_state": {
        const serverState = (event["state"] as string) || "idle";
        // 映射后端状态到前端类型
        if (serverState === "starting" || serverState === "idle" || serverState === "streaming" || serverState === "waiting_permission" || serverState === "closed") {
          this._setState(serverState as ChatState);
        } else {
          this._setState("connected");
        }
        // _state 携带真实 session_id，发送给 viewer 以便 JSONL 查找
        const stateSessionId = event["session_id"] as string | undefined;
        if (stateSessionId) {
          this.emit("session-id", stateSessionId);
        }
        // 收到 _state 后尝试发送缓冲消息
        this._flushPending();
        break;
      }

      case "system": {
        const subtype = event["subtype"] as string | undefined;
        // init 事件表示 Claude 已就绪，携带真实 session_id
        if (subtype === "init") {
          this._setState("idle");
          const sessionId = event["session_id"] as string | undefined;
          if (sessionId) {
            this.emit("session-id", sessionId);
          }
          this._flushPending();
        }
        // status 事件：compacting / null（完成）
        if (subtype === "status") {
          const status = (event["status"] as string | null) ?? null;
          this.emit("status", status);
        }
        break;
      }

      case "stream_event": {
        this._setState("streaming");
        const inner = event["event"] as Record<string, unknown> | undefined;
        const innerType = inner?.["type"] as string | undefined;

        if (innerType === "content_block_start") {
          const block = inner!["content_block"] as Record<string, unknown> | undefined;
          const idx = (inner!["index"] as number) ?? -1;
          if (block?.["type"] === "tool_use") {
            const toolName = (block["name"] as string) || "";
            this._activeToolBlocks.set(idx, { name: toolName, partialJson: "" });
            // 先发出初始 activity（input 为空，complete=false 表示正在接收参数）
            this.emit("tool-activity", {
              toolName,
              input: {},
              complete: false,
              timestamp: Date.now(),
            });
          }
        } else if (innerType === "content_block_delta") {
          const delta = (inner!["delta"] as Record<string, unknown>) || {};
          const idx = (inner!["index"] as number) ?? -1;
          const deltaType = delta["type"] as string;
          if (deltaType === "text_delta" && typeof delta["text"] === "string") {
            this.emit("text-delta", delta["text"] as string);
          } else if (deltaType === "thinking_delta" && typeof delta["thinking"] === "string") {
            this.emit("thinking-delta", delta["thinking"] as string);
          } else if (deltaType === "input_json_delta") {
            // 累积工具输入 JSON
            const block = this._activeToolBlocks.get(idx);
            if (block) block.partialJson += (delta["partial_json"] as string) || "";
          }
        } else if (innerType === "content_block_stop") {
          const idx = (inner!["index"] as number) ?? -1;
          const block = this._activeToolBlocks.get(idx);
          if (block) {
            let parsedInput: Record<string, unknown> = {};
            try { parsedInput = JSON.parse(block.partialJson); } catch { /* 忽略解析失败 */ }
            // 发出完整的 activity（complete=true，input 已完整）
            this.emit("tool-activity", {
              toolName: block.name,
              input: parsedInput,
              complete: true,
              timestamp: Date.now(),
            });
            this._activeToolBlocks.delete(idx);
          }
        }
        break;
      }

      case "assistant":
        this.emit("assistant-message", event);
        break;

      case "control_request": {
        this._setState("waiting_permission");
        const req = event["request"] as Record<string, unknown>;
        // 兼容 type 与 subtype 两个字段名（不同版本 Claude Code 可能不同）
        const reqKind = (req?.["type"] as string) || (req?.["subtype"] as string) || "";
        if (reqKind === "can_use_tool" || reqKind === "canUseTool") {
          // 兼容 snake_case（tool_name）和 camelCase（toolName）
          const toolName =
            (req["tool_name"] as string) || (req["toolName"] as string) || "";
          this.emit("permission-request", {
            requestId: (event["request_id"] as string) || (event["requestId"] as string) || "",
            toolName,
            input: (req["input"] as Record<string, unknown>) || {},
          });
        }
        break;
      }

      case "result": {
        this._setState("idle");
        this.emit("result", event);
        // 提取 stats 并发出 result-stats 事件
        const stats = event["stats"] as Record<string, unknown> | undefined;
        if (stats) {
          this.emit("result-stats", {
            input_tokens: (stats["input_tokens"] as number) || 0,
            output_tokens: (stats["output_tokens"] as number) || 0,
            cost_usd: (stats["cost_usd"] as number) ?? null,
          });
        }
        break;
      }

      case "_internal":
        if (event["subtype"] === "closed") {
          this._setState("closed");
          this.emit("closed", undefined as never);
        }
        break;

      case "session_heartbeat":
        this._lastHeartbeat = Date.now();
        if (this._heartbeatStale) {
          this._heartbeatStale = false;
          this.emit("heartbeat", { lastTs: this._lastHeartbeat, stale: false });
        }
        break;

      case "error":
        this.emit("error", (event["message"] as string) || "未知错误");
        break;
    }
  }

  private _startHeartbeatChecker(): void {
    this._stopHeartbeatChecker();
    this._lastHeartbeat = 0;
    this._heartbeatStale = false;
    this._heartbeatChecker = setInterval(() => {
      if (!this._lastHeartbeat) return; // 还没收到过心跳（可能是本地会话）
      const elapsed = Date.now() - this._lastHeartbeat;
      const stale = elapsed > 10_000;
      if (stale !== this._heartbeatStale) {
        this._heartbeatStale = stale;
        this.emit("heartbeat", { lastTs: this._lastHeartbeat, stale });
      }
    }, 3_000);
  }

  private _stopHeartbeatChecker(): void {
    if (this._heartbeatChecker) {
      clearInterval(this._heartbeatChecker);
      this._heartbeatChecker = null;
    }
    this._lastHeartbeat = 0;
    this._heartbeatStale = false;
  }
}
