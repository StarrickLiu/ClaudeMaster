// chat-input 组件单元测试：发送条件、状态文本
import { describe, expect, it } from "vitest";
import type { ChatState } from "../services/chat-client.js";

/** 是否可以发送消息（与组件 _canSend 逻辑一致） */
function canSend(chatState: ChatState): boolean {
  return chatState !== "error";
}

/** 是否处于流式状态（与组件 _isStreaming 逻辑一致） */
function isStreaming(chatState: ChatState): boolean {
  return chatState === "streaming" || chatState === "waiting_permission";
}

/** 状态文本映射（与组件 _statusText 逻辑一致） */
function statusText(chatState: ChatState): string {
  const map: Record<string, string> = {
    connecting: "正在连接...",
    connected: "已连接",
    starting: "Claude 启动中...",
    streaming: "Claude 正在回复...",
    waiting_permission: "等待权限确认",
    idle: "就绪",
    closed: "已断开 · 发消息将自动重连",
    error: "连接失败",
  };
  return map[chatState] || chatState;
}

describe("canSend", () => {
  it("allows sending in idle state", () => {
    expect(canSend("idle")).toBe(true);
  });

  it("allows sending in closed state (auto-reconnect)", () => {
    expect(canSend("closed")).toBe(true);
  });

  it("allows sending in streaming state", () => {
    expect(canSend("streaming")).toBe(true);
  });

  it("allows sending in connecting state", () => {
    expect(canSend("connecting")).toBe(true);
  });

  it("blocks sending in error state", () => {
    expect(canSend("error")).toBe(false);
  });
});

describe("isStreaming", () => {
  it("returns true for streaming", () => {
    expect(isStreaming("streaming")).toBe(true);
  });

  it("returns true for waiting_permission", () => {
    expect(isStreaming("waiting_permission")).toBe(true);
  });

  it("returns false for idle", () => {
    expect(isStreaming("idle")).toBe(false);
  });

  it("returns false for closed", () => {
    expect(isStreaming("closed")).toBe(false);
  });

  it("returns false for error", () => {
    expect(isStreaming("error")).toBe(false);
  });
});

describe("statusText", () => {
  const allStates: ChatState[] = [
    "connecting", "connected", "starting", "streaming",
    "waiting_permission", "idle", "closed", "error",
  ];

  it("returns non-empty string for all states", () => {
    for (const state of allStates) {
      expect(statusText(state).length).toBeGreaterThan(0);
    }
  });

  it("shows reconnect hint for closed state", () => {
    expect(statusText("closed")).toContain("自动重连");
  });

  it("shows error text for error state", () => {
    expect(statusText("error")).toContain("失败");
  });

  it("shows ready text for idle state", () => {
    expect(statusText("idle")).toBe("就绪");
  });
});

describe("send button state", () => {
  function isSendDisabled(chatState: ChatState, text: string): boolean {
    return !canSend(chatState) || !text.trim();
  }

  it("disabled when text is empty", () => {
    expect(isSendDisabled("idle", "")).toBe(true);
  });

  it("disabled when text is whitespace only", () => {
    expect(isSendDisabled("idle", "   ")).toBe(true);
  });

  it("enabled when text has content and state is idle", () => {
    expect(isSendDisabled("idle", "hello")).toBe(false);
  });

  it("disabled when state is error even with text", () => {
    expect(isSendDisabled("error", "hello")).toBe(true);
  });

  it("enabled when state is closed with text (auto-reconnect)", () => {
    expect(isSendDisabled("closed", "hello")).toBe(false);
  });
});
