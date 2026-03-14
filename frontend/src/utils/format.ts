// 共享格式化工具函数

/** 格式化 token 数量（带 K/M 缩写） */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
  return `${n}`;
}

/** 格式化运行时长（支持天/时/分/秒） */
export function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600) % 24;
  const d = Math.floor(seconds / 86400);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

/** 从工具 input 提取简短描述（适用于活动面板和工具调用摘要） */
export function toolDescription(name: string, input: Record<string, unknown>): string {
  const s = (v: unknown) => String(v ?? "").slice(0, 80);
  switch (name) {
    case "Bash":        return s(input["command"]);
    case "Read":        return s(input["file_path"]);
    case "Write":       return s(input["file_path"]);
    case "Edit":        return s(input["file_path"]);
    case "MultiEdit":   return s(input["file_path"]);
    case "NotebookEdit":return s(input["notebook_path"]);
    case "NotebookRead":return s(input["notebook_path"]);
    case "Glob":        return s(input["pattern"]);
    case "Grep":        return `"${s(input["pattern"])}"${input["path"] ? ` in ${s(input["path"])}` : ""}`;
    case "WebFetch":    return s(input["url"]);
    case "WebSearch":   return s(input["query"]);
    case "Task":        return s(input["description"]);
    case "LS":          return s(input["path"]);
    default:            return "";
  }
}
