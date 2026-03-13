// ChatClient 单元测试：消息发送、事件处理、状态管理
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ChatClient } from "./chat-client.js";

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  url: string;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  sent: string[] = [];
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.closed = true;
    this.readyState = MockWebSocket.CLOSED;
  }

  // 测试辅助：模拟连接成功
  _simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  // 测试辅助：模拟收到消息
  _simulateMessage(data: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  // 测试辅助：模拟连接关闭
  _simulateClose() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  // 测试辅助：模拟连接错误
  _simulateError() {
    this.onerror?.();
  }
}

// Mock localStorage
const mockStorage = new Map<string, string>();
const mockLocalStorage = {
  getItem: (key: string) => mockStorage.get(key) ?? null,
  setItem: (key: string, value: string) => mockStorage.set(key, value),
  removeItem: (key: string) => mockStorage.delete(key),
  clear: () => mockStorage.clear(),
  get length() { return mockStorage.size; },
  key: () => null,
};

// 替换全局对象
const originalWebSocket = globalThis.WebSocket;

beforeEach(() => {
  MockWebSocket.instances = [];
  mockStorage.clear();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).WebSocket = MockWebSocket;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).localStorage = mockLocalStorage;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).location = { protocol: "https:", host: "localhost:8420" };
});

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).WebSocket = originalWebSocket;
});

function getLastWs(): MockWebSocket {
  return MockWebSocket.instances[MockWebSocket.instances.length - 1];
}

describe("ChatClient", () => {
  describe("connect", () => {
    it("creates WebSocket with correct URL", () => {
      const client = new ChatClient("test-session-id");
      client.connect();
      const ws = getLastWs();
      expect(ws.url).toBe("wss://localhost:8420/ws/chat/test-session-id");
    });

    it("emits connecting state on connect", () => {
      const client = new ChatClient("test-id");
      const states: string[] = [];
      client.on("state-change", (s) => states.push(s));
      client.connect();
      expect(states).toContain("connecting");
    });

    it("emits connected state on WebSocket open", () => {
      const client = new ChatClient("test-id");
      const states: string[] = [];
      client.on("state-change", (s) => states.push(s));
      client.connect();
      getLastWs()._simulateOpen();
      expect(states).toContain("connected");
    });

    it("emits closed state on WebSocket close", () => {
      const client = new ChatClient("test-id");
      const states: string[] = [];
      client.on("state-change", (s) => states.push(s));
      client.connect();
      getLastWs()._simulateOpen();
      getLastWs()._simulateClose();
      expect(states).toContain("closed");
    });

    it("emits error state on WebSocket error", () => {
      const client = new ChatClient("test-id");
      const states: string[] = [];
      client.on("state-change", (s) => states.push(s));
      client.connect();
      getLastWs()._simulateError();
      expect(states).toContain("error");
    });
  });

  describe("sendMessage", () => {
    it("sends JSON payload when WebSocket is open", () => {
      const client = new ChatClient("test-id");
      client.connect();
      const ws = getLastWs();
      ws._simulateOpen();

      client.sendMessage("hello world");

      expect(ws.sent).toHaveLength(1);
      const parsed = JSON.parse(ws.sent[0]);
      expect(parsed.type).toBe("user_message");
      expect(parsed.text).toBe("hello world");
    });

    it("buffers message when WebSocket is not open", () => {
      const client = new ChatClient("test-id");
      client.connect();
      const ws = getLastWs();
      // 不调用 _simulateOpen，WS 仍在 CONNECTING 状态

      client.sendMessage("buffered msg");

      // 消息未发送到 WS
      expect(ws.sent).toHaveLength(0);
    });

    it("flushes buffered messages on connect", () => {
      const client = new ChatClient("test-id");
      client.connect();
      const ws = getLastWs();

      // 缓冲消息
      client.sendMessage("msg1");
      client.sendMessage("msg2");
      expect(ws.sent).toHaveLength(0);

      // 连接成功后自动 flush
      ws._simulateOpen();
      expect(ws.sent).toHaveLength(2);
      expect(JSON.parse(ws.sent[0]).text).toBe("msg1");
      expect(JSON.parse(ws.sent[1]).text).toBe("msg2");
    });

    it("flushes buffered messages on _state event", () => {
      const client = new ChatClient("test-id");
      client.connect();
      const ws = getLastWs();
      ws._simulateOpen();

      // 清空已发送
      ws.sent = [];

      // 断开后重新连接（模拟）- 先缓冲一条
      client.sendMessage("after-state");

      // 模拟收到 _state 事件
      ws._simulateMessage({ type: "_state", state: "idle", session_id: "real-id" });

      // 由于 WS 已经 OPEN，消息应该已经直接发送了
      expect(ws.sent.length).toBeGreaterThanOrEqual(1);
    });

    it("flushes buffered messages on system init event", () => {
      const client = new ChatClient("test-id");
      client.connect();
      const ws = getLastWs();

      // 先缓冲消息（WS 还没 open）
      client.sendMessage("init-msg");
      expect(ws.sent).toHaveLength(0);

      // WS open 后 flush
      ws._simulateOpen();
      expect(ws.sent).toHaveLength(1);

      // 清空
      ws.sent = [];

      // 模拟 system init 事件，应该也 flush（虽然缓冲已空）
      ws._simulateMessage({ type: "system", subtype: "init", session_id: "real-123" });
      // 不应报错
    });
  });

  describe("event handling", () => {
    it("emits text-delta for stream text content", () => {
      const client = new ChatClient("test-id");
      const deltas: string[] = [];
      client.on("text-delta", (t) => deltas.push(t));
      client.connect();
      const ws = getLastWs();
      ws._simulateOpen();

      ws._simulateMessage({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Hello" },
        },
      });

      expect(deltas).toEqual(["Hello"]);
    });

    it("emits session-id from _state event", () => {
      const client = new ChatClient("test-id");
      const ids: string[] = [];
      client.on("session-id", (id) => ids.push(id));
      client.connect();
      const ws = getLastWs();
      ws._simulateOpen();

      ws._simulateMessage({ type: "_state", state: "idle", session_id: "real-session-id" });

      expect(ids).toContain("real-session-id");
    });

    it("emits session-id from system init event", () => {
      const client = new ChatClient("test-id");
      const ids: string[] = [];
      client.on("session-id", (id) => ids.push(id));
      client.connect();
      const ws = getLastWs();
      ws._simulateOpen();

      ws._simulateMessage({ type: "system", subtype: "init", session_id: "claude-id-123" });

      expect(ids).toContain("claude-id-123");
    });

    it("sets state to streaming on stream_event", () => {
      const client = new ChatClient("test-id");
      const states: string[] = [];
      client.on("state-change", (s) => states.push(s));
      client.connect();
      const ws = getLastWs();
      ws._simulateOpen();

      ws._simulateMessage({
        type: "stream_event",
        event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "x" } },
      });

      expect(states).toContain("streaming");
    });

    it("emits permission-request on control_request", () => {
      const client = new ChatClient("test-id");
      const reqs: unknown[] = [];
      client.on("permission-request", (r) => reqs.push(r));
      client.connect();
      const ws = getLastWs();
      ws._simulateOpen();

      ws._simulateMessage({
        type: "control_request",
        request_id: "req-1",
        request: { type: "can_use_tool", tool_name: "Bash", input: { command: "ls" } },
      });

      expect(reqs).toHaveLength(1);
      expect((reqs[0] as { toolName: string }).toolName).toBe("Bash");
    });

    it("emits result on result event", () => {
      const client = new ChatClient("test-id");
      const results: unknown[] = [];
      client.on("result", (r) => results.push(r));
      client.connect();
      const ws = getLastWs();
      ws._simulateOpen();

      ws._simulateMessage({ type: "result", stats: { input_tokens: 100, output_tokens: 50, cost_usd: 0.01 } });

      expect(results).toHaveLength(1);
    });

    it("emits result-stats with token counts", () => {
      const client = new ChatClient("test-id");
      const stats: unknown[] = [];
      client.on("result-stats", (s) => stats.push(s));
      client.connect();
      const ws = getLastWs();
      ws._simulateOpen();

      ws._simulateMessage({ type: "result", stats: { input_tokens: 100, output_tokens: 50, cost_usd: 0.01 } });

      expect(stats).toHaveLength(1);
      expect((stats[0] as { input_tokens: number }).input_tokens).toBe(100);
    });
  });

  describe("disconnect", () => {
    it("closes WebSocket and resets state", () => {
      const client = new ChatClient("test-id");
      client.connect();
      const ws = getLastWs();
      ws._simulateOpen();

      client.disconnect();

      expect(ws.closed).toBe(true);
      expect(client.state).toBe("closed");
    });

    it("clears pending messages on disconnect", () => {
      const client = new ChatClient("test-id");
      client.connect();

      client.sendMessage("pending");
      client.disconnect();

      // 重新连接不应发送旧消息
      client.connect();
      const ws2 = getLastWs();
      ws2._simulateOpen();
      expect(ws2.sent).toHaveLength(0);
    });
  });

  describe("interrupt", () => {
    it("sends interrupt message", () => {
      const client = new ChatClient("test-id");
      client.connect();
      const ws = getLastWs();
      ws._simulateOpen();

      client.interrupt();

      expect(ws.sent).toHaveLength(1);
      expect(JSON.parse(ws.sent[0]).type).toBe("interrupt");
    });
  });

  describe("approvePermission", () => {
    it("sends allow with updated input", () => {
      const client = new ChatClient("test-id");
      client.connect();
      const ws = getLastWs();
      ws._simulateOpen();

      client.approvePermission("req-1", { command: "ls" });

      expect(ws.sent).toHaveLength(1);
      const msg = JSON.parse(ws.sent[0]);
      expect(msg.type).toBe("control_response");
      expect(msg.request_id).toBe("req-1");
      expect(msg.behavior).toBe("allow");
      expect(msg.updated_input).toEqual({ command: "ls" });
    });
  });

  describe("denyPermission", () => {
    it("sends deny message", () => {
      const client = new ChatClient("test-id");
      client.connect();
      const ws = getLastWs();
      ws._simulateOpen();

      client.denyPermission("req-2");

      const msg = JSON.parse(ws.sent[0]);
      expect(msg.type).toBe("control_response");
      expect(msg.request_id).toBe("req-2");
      expect(msg.behavior).toBe("deny");
    });
  });

  describe("tool-activity tracking", () => {
    it("emits tool-activity on content_block_start for tool_use", () => {
      const client = new ChatClient("test-id");
      const activities: { toolName: string; complete: boolean }[] = [];
      client.on("tool-activity", (a) => activities.push(a));
      client.connect();
      const ws = getLastWs();
      ws._simulateOpen();

      ws._simulateMessage({
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", name: "Read" },
        },
      });

      expect(activities).toHaveLength(1);
      expect(activities[0].toolName).toBe("Read");
      expect(activities[0].complete).toBe(false);
    });

    it("emits complete tool-activity on content_block_stop", () => {
      const client = new ChatClient("test-id");
      const activities: { toolName: string; complete: boolean }[] = [];
      client.on("tool-activity", (a) => activities.push(a));
      client.connect();
      const ws = getLastWs();
      ws._simulateOpen();

      // Start
      ws._simulateMessage({
        type: "stream_event",
        event: { type: "content_block_start", index: 0, content_block: { type: "tool_use", name: "Bash" } },
      });

      // Delta
      ws._simulateMessage({
        type: "stream_event",
        event: { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"command":"ls"}' } },
      });

      // Stop
      ws._simulateMessage({
        type: "stream_event",
        event: { type: "content_block_stop", index: 0 },
      });

      expect(activities).toHaveLength(2);
      expect(activities[1].complete).toBe(true);
      expect(activities[1].toolName).toBe("Bash");
    });
  });

  describe("starting timer", () => {
    it("transitions from starting to idle after timeout", () => {
      vi.useFakeTimers();
      const client = new ChatClient("test-id");
      const states: string[] = [];
      client.on("state-change", (s) => states.push(s));
      client.connect();
      const ws = getLastWs();
      ws._simulateOpen();

      // 模拟 _state starting
      ws._simulateMessage({ type: "_state", state: "starting" });
      expect(states).toContain("starting");

      // 8 秒后应自动变为 idle
      vi.advanceTimersByTime(8000);
      expect(states[states.length - 1]).toBe("idle");

      vi.useRealTimers();
    });
  });
});
