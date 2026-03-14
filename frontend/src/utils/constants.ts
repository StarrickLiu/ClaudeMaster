// 会话配置常量：模型、权限模式、工具预设
export const MODEL_OPTIONS = [
  { value: "", label: "默认" },
  { value: "sonnet", label: "Sonnet" },
  { value: "opus", label: "Opus" },
  { value: "haiku", label: "Haiku" },
];

export const PERMISSION_MODES = [
  { value: "default", label: "默认（手动确认）" },
  { value: "acceptEdits", label: "自动接受编辑" },
  { value: "plan", label: "仅计划模式" },
  { value: "bypassPermissions", label: "跳过所有权限" },
];

export const TOOL_PRESETS: { label: string; tools: string[] }[] = [
  { label: "完全", tools: [] },
  { label: "只读", tools: ["Read", "Glob", "Grep", "WebFetch", "WebSearch"] },
  { label: "无 Bash", tools: ["Read", "Glob", "Grep", "Edit", "Write", "WebFetch", "WebSearch"] },
];
