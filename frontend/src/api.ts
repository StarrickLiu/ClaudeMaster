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
  project_path: string;
  project_name: string;
  first_message: string | null;
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

export interface HistoryEntry {
  display: string;
  timestamp: number;
  project: string;
  session_id: string;
}

// API 方法
export const api = {
  getProjects: () =>
    request<Project[]>("/api/projects"),

  getSessions: (params?: { project?: string; limit?: string; offset?: string }) =>
    request<{ items: SessionSummary[]; total: number }>("/api/sessions", params),

  getSession: (sessionId: string, project: string) =>
    request<SessionDetail>(`/api/sessions/${sessionId}`, { project }),

  getProcesses: () =>
    request<ClaudeProcess[]>("/api/processes"),

  getHistory: (params?: { limit?: string; offset?: string; search?: string }) =>
    request<{ items: HistoryEntry[]; total: number }>("/api/history", params),

  getDiff: (projectPath: string) =>
    request<{ diff: string; stat: string }>("/api/diff", { project_path: projectPath }),
};
