// 后端 API 请求封装
const BASE = "";

async function request<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(path, window.location.origin);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    }
  }

  const headers: Record<string, string> = {};
  const token = localStorage.getItem("cm_auth_token");
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(url.toString(), { headers });

  if (res.status === 401) {
    const newToken = prompt("请输入访问令牌：");
    if (newToken) {
      localStorage.setItem("cm_auth_token", newToken);
      return request(path, params);
    }
    throw new Error("未授权");
  }

  if (!res.ok) {
    throw new Error(`API 请求失败: ${res.status}`);
  }

  return res.json();
}

async function requestPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const url = new URL(path, window.location.origin);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = localStorage.getItem("cm_auth_token");
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(url.toString(), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (res.status === 401) {
    const newToken = prompt("请输入访问令牌：");
    if (newToken) {
      localStorage.setItem("cm_auth_token", newToken);
      return requestPost(path, body);
    }
    throw new Error("未授权");
  }

  if (!res.ok) throw new Error(`API 请求失败: ${res.status}`);
  return res.json();
}

async function requestPatch<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const url = new URL(path, window.location.origin);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = localStorage.getItem("cm_auth_token");
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(url.toString(), {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });

  if (res.status === 401) {
    const newToken = prompt("请输入访问令牌：");
    if (newToken) {
      localStorage.setItem("cm_auth_token", newToken);
      return requestPatch(path, body);
    }
    throw new Error("未授权");
  }

  if (!res.ok) throw new Error(`API 请求失败: ${res.status}`);
  return res.json();
}

// 类型定义
export interface Project {
  path: string;
  name: string;
  encoded_name: string;
  session_count: number;
  last_activity: string | null;
}

export interface SessionSummary {
  session_id: string;
  resume_session_id: string | null;  // JSONL 内部 sessionId，用于 claude --resume
  project_path: string;
  project_name: string;
  first_message: string | null;
  last_assistant_text: string | null;
  user_turns: number;
  tool_use_count: number;
  message_count: number;
  start_time: string | null;
  end_time: string | null;
  git_branch: string | null;
  is_active: boolean;
  total_input_tokens: number;
  total_output_tokens: number;
}

export interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

export interface Message {
  uuid: string;
  parent_uuid: string | null;
  type: string;
  timestamp: string;
  session_id: string;
  is_sidechain: boolean;
  cwd: string | null;
  git_branch: string | null;
  version: string | null;
  agent_id: string | null;
  request_id: string | null;
  role: string | null;
  content: string | ContentBlock[];
  model_name: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  } | null;
}

export interface SessionDetail {
  summary: SessionSummary;
  messages: Message[];
}

export interface ClaudeProcess {
  pid: number;
  cwd: string;
  uptime_seconds: number;
  project_name: string | null;
  session_id: string | null;
  git_branch: string | null;
}

export interface CommitInfo {
  hash: string;
  short_hash: string;
  subject: string;
  author: string;
  date: string;
  stat: string;
  insertions: number;
  deletions: number;
  files_changed: number;
}

export interface HistoryEntry {
  display: string;
  timestamp: number;
  project: string;
  session_id: string;
}

export interface ChatSessionInfo {
  session_id: string;
  project_path: string;
  state: string;
  name: string;
  launch_config: {
    model?: string | null;
    allowed_tools?: string[] | null;
    permission_mode?: string | null;
    max_budget_usd?: number | null;
    max_turns?: number | null;
    append_system_prompt?: string | null;
    add_dirs?: string[] | null;
  };
  /** 真实 Claude session_id（与 JSONL 一致），initial_id 不同时才有值 */
  claude_session_id: string | null;
  pending_tool: string | null;
}

export interface SearchResult {
  summary: SessionSummary;
  snippets: string[];
}

export interface UsageStats {
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  total_tokens: number;
  cost_usd: number;
  message_count: number;
}

export interface DailyUsage {
  date: string;
  total_tokens: number;
  cost_usd: number;
  message_count: number;
}

export interface UsageResponse {
  today: UsageStats;
  window_5h: UsageStats;
  daily: DailyUsage[];
}

export interface QuotaWindow {
  utilization: number;
  resets_at: string | null;
  remaining: number;
}

export interface QuotaResponse {
  five_hour: QuotaWindow | null;
  seven_day: QuotaWindow | null;
  seven_day_sonnet: QuotaWindow | null;
  seven_day_opus: QuotaWindow | null;
  subscription_type: string | null;
  error: string | null;
}

// API 方法
export const api = {
  getProjects: () =>
    request<Project[]>("/api/projects"),

  getSessions: (params?: { project?: string; limit?: string; offset?: string }) =>
    request<{ items: SessionSummary[]; total: number }>("/api/sessions", params),

  searchSessions: (q: string, project?: string) =>
    request<{ items: SearchResult[]; total: number }>("/api/sessions/search", {
      q,
      ...(project ? { project } : {}),
    }),

  getSession: (sessionId: string, project: string) =>
    request<SessionDetail>(`/api/sessions/${sessionId}`, { project }),

  getProcesses: () =>
    request<ClaudeProcess[]>("/api/processes"),

  getHistory: (params?: { limit?: string; offset?: string; search?: string }) =>
    request<{ items: HistoryEntry[]; total: number }>("/api/history", params),

  getDiff: (projectPath: string) =>
    request<{ diff: string; stat: string }>("/api/diff", { project_path: projectPath }),

  getCommits: (projectPath: string, limit = 20) =>
    request<CommitInfo[]>("/api/commits", { project_path: projectPath, limit: String(limit) }),

  getCommitDiff: (projectPath: string, hash: string) =>
    request<{ diff: string }>("/api/commit", { project_path: projectPath, hash }),

  startChat: (
    projectPath: string,
    resumeSessionId?: string,
    options?: {
      allowedTools?: string[];
      permissionMode?: string;
      maxBudgetUsd?: number;
      maxTurns?: number;
      appendSystemPrompt?: string;
      model?: string;
      addDirs?: string[];
      name?: string;
    }
  ) =>
    requestPost<ChatSessionInfo>("/api/chat/start", {
      project_path: projectPath,
      resume_session_id: resumeSessionId ?? null,
      allowed_tools: options?.allowedTools ?? null,
      permission_mode: options?.permissionMode ?? null,
      max_budget_usd: options?.maxBudgetUsd ?? null,
      max_turns: options?.maxTurns ?? null,
      append_system_prompt: options?.appendSystemPrompt ?? null,
      model: options?.model ?? null,
      add_dirs: options?.addDirs ?? null,
      name: options?.name ?? null,
    }),

  stopChat: (sessionId: string) =>
    requestPost<{ success: boolean }>(`/api/chat/${sessionId}/stop`, {}),

  updateChatSession: (sessionId: string, update: { name?: string }) =>
    requestPatch<ChatSessionInfo>(`/api/chat/${sessionId}`, update),

  listChatSessions: () =>
    request<ChatSessionInfo[]>("/api/chat/sessions"),

  getUsage: () =>
    request<UsageResponse>("/api/usage"),

  getUsageChart: (days: number) =>
    request<DailyUsage[]>("/api/usage/chart", { days: String(days) }),

  getQuota: () =>
    request<QuotaResponse>("/api/quota"),
};
