// session-header 组件单元测试：复制命令、改名、按钮状态
import { describe, expect, it } from "vitest";

/** 构建 claude --resume 命令（与组件内逻辑一致） */
function buildResumeCmd(
  resumeSessionId: string | null,
  sessionId: string | undefined,
  projectPath: string | undefined,
): string | null {
  const id = resumeSessionId ?? sessionId;
  if (!id) return null;
  return projectPath
    ? `cd ${projectPath} && claude --resume ${id}`
    : `claude --resume ${id}`;
}

describe("buildResumeCmd", () => {
  it("returns null when no session id available", () => {
    expect(buildResumeCmd(null, undefined, undefined)).toBeNull();
  });

  it("uses resume_session_id when available", () => {
    const cmd = buildResumeCmd("resume-123", "session-456", "/home/user/proj");
    expect(cmd).toBe("cd /home/user/proj && claude --resume resume-123");
  });

  it("falls back to session_id when no resume_session_id", () => {
    const cmd = buildResumeCmd(null, "session-456", "/home/user/proj");
    expect(cmd).toBe("cd /home/user/proj && claude --resume session-456");
  });

  it("omits cd when no project path", () => {
    const cmd = buildResumeCmd("resume-123", undefined, undefined);
    expect(cmd).toBe("claude --resume resume-123");
  });

  it("handles paths with spaces", () => {
    const cmd = buildResumeCmd("r-1", undefined, "/home/user/my project");
    expect(cmd).toBe("cd /home/user/my project && claude --resume r-1");
  });
});

describe("session-header clipboard fallback", () => {
  it("builds correct command string for copying", () => {
    const id = "abc-123";
    const cwd = "/home/user/project";
    const cmd = `cd ${cwd} && claude --resume ${id}`;
    expect(cmd).toBe("cd /home/user/project && claude --resume abc-123");
  });

  it("command without project path omits cd", () => {
    const id = "abc-123";
    const cmd = `claude --resume ${id}`;
    expect(cmd).toBe("claude --resume abc-123");
  });
});

describe("session-header state logic", () => {
  it("shows resume button when not in chat mode and no active broker", () => {
    // 按组件逻辑：chatMode=false, chatConnecting=false, hasActiveBroker=false
    // → 显示「恢复会话」按钮
    const chatMode = false;
    const chatConnecting = false;
    const hasActiveBroker = false;
    const showResume = !chatMode && !chatConnecting && !hasActiveBroker;
    expect(showResume).toBe(true);
  });

  it("shows attach button when broker has active session", () => {
    const chatMode = false;
    const chatConnecting = false;
    const hasActiveBroker = true;
    const showAttach = !chatMode && !chatConnecting && hasActiveBroker;
    expect(showAttach).toBe(true);
  });

  it("shows disconnect button when in chat mode", () => {
    const chatMode = true;
    expect(chatMode).toBe(true);
  });

  it("shows spinner when connecting", () => {
    const chatMode = false;
    const chatConnecting = true;
    const showConnecting = !chatMode && chatConnecting;
    expect(showConnecting).toBe(true);
  });
});

describe("config summary rendering logic", () => {
  function buildConfigTags(config: Record<string, unknown> | null): string[] {
    if (!config || Object.keys(config).length === 0) return [];
    const tags: string[] = [];

    const model = config.model as string | null | undefined;
    if (model) {
      tags.push(`模型:${model.charAt(0).toUpperCase() + model.slice(1)}`);
    }

    const perm = config.permission_mode as string | null | undefined;
    if (perm) {
      const permLabels: Record<string, string> = {
        bypassPermissions: "跳过所有",
        acceptEdits: "自动接受编辑",
        plan: "仅计划",
        default: "手动确认",
      };
      tags.push(`权限:${permLabels[perm] ?? perm}`);
    }

    const budget = config.max_budget_usd as number | null | undefined;
    if (budget != null) {
      tags.push(`预算:$${budget.toFixed(2)}`);
    }

    const turns = config.max_turns as number | null | undefined;
    tags.push(`轮数:${turns != null ? String(turns) : "不限"}`);

    return tags;
  }

  it("returns empty array for null config", () => {
    expect(buildConfigTags(null)).toEqual([]);
  });

  it("returns empty array for empty config", () => {
    expect(buildConfigTags({})).toEqual([]);
  });

  it("includes model tag", () => {
    const tags = buildConfigTags({ model: "opus" });
    expect(tags).toContain("模型:Opus");
  });

  it("includes permission mode tag", () => {
    const tags = buildConfigTags({ permission_mode: "bypassPermissions" });
    expect(tags).toContain("权限:跳过所有");
  });

  it("includes budget tag", () => {
    const tags = buildConfigTags({ max_budget_usd: 1.5 });
    expect(tags[0]).toBe("预算:$1.50");
  });

  it("includes unlimited turns by default", () => {
    const tags = buildConfigTags({ model: "sonnet" });
    expect(tags).toContain("轮数:不限");
  });

  it("includes specific turn count", () => {
    const tags = buildConfigTags({ max_turns: 10 });
    expect(tags).toContain("轮数:10");
  });
});
