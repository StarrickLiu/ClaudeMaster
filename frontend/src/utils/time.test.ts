// 时间工具函数单元测试
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { timeAgo, formatDuration } from "./time.js";

describe("timeAgo", () => {
  beforeEach(() => {
    // 固定 Date.now() = 2024-06-01T12:00:00Z
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-01T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns '刚刚' for future timestamps", () => {
    expect(timeAgo("2024-06-01T12:01:00Z")).toBe("刚刚");
  });

  it("returns '刚刚' for timestamps within 60 seconds", () => {
    expect(timeAgo("2024-06-01T11:59:30Z")).toBe("刚刚");
  });

  it("returns minutes for 1–59 minutes ago", () => {
    expect(timeAgo("2024-06-01T11:50:00Z")).toBe("10 分钟前");
    expect(timeAgo("2024-06-01T11:01:00Z")).toBe("59 分钟前");
  });

  it("returns hours for 1–23 hours ago", () => {
    expect(timeAgo("2024-06-01T10:00:00Z")).toBe("2 小时前");
    expect(timeAgo("2024-05-31T13:00:00Z")).toBe("23 小时前");
  });

  it("returns days for 1–29 days ago", () => {
    expect(timeAgo("2024-05-31T12:00:00Z")).toBe("1 天前");
    expect(timeAgo("2024-05-03T12:00:00Z")).toBe("29 天前");
  });

  // days < 30 → 天前；days >= 30 → 月前（30天 = 1个月）
  it("returns months for 30+ days ago", () => {
    expect(timeAgo("2024-05-02T12:00:00Z")).toBe("1 个月前");  // 正好 30 天
    expect(timeAgo("2024-05-01T12:00:00Z")).toBe("1 个月前");
    expect(timeAgo("2024-03-01T12:00:00Z")).toBe("3 个月前");
  });

  it("accepts numeric timestamp", () => {
    const ts = new Date("2024-06-01T11:50:00Z").getTime();
    expect(timeAgo(ts)).toBe("10 分钟前");
  });
});

describe("formatDuration", () => {
  it("formats seconds", () => {
    expect(formatDuration(45)).toBe("45 秒");
    expect(formatDuration(1)).toBe("1 秒");
  });

  it("formats minutes", () => {
    expect(formatDuration(60)).toBe("1 分钟");
    expect(formatDuration(90)).toBe("1 分钟");
    expect(formatDuration(3599)).toBe("59 分钟");
  });

  it("formats hours without remainder", () => {
    expect(formatDuration(3600)).toBe("1 小时");
    expect(formatDuration(7200)).toBe("2 小时");
  });

  it("formats hours with remainder minutes", () => {
    expect(formatDuration(3660)).toBe("1 小时 1 分");
    expect(formatDuration(5400)).toBe("1 小时 30 分");
  });

  it("formats days", () => {
    expect(formatDuration(86400)).toBe("1 天");
    expect(formatDuration(172800)).toBe("2 天");
  });
});
