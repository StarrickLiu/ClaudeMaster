// 时间格式化工具

export function timeAgo(timestamp: string | number): string {
  const date = typeof timestamp === "number"
    ? new Date(timestamp)
    : new Date(timestamp);
  const now = Date.now();
  const diff = now - date.getTime();

  if (diff < 0) return "刚刚";

  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "刚刚";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;

  const months = Math.floor(days / 30);
  return `${months} 个月前`;
}

export function formatDateTime(timestamp: string | number): string {
  const date = typeof timestamp === "number"
    ? new Date(timestamp)
    : new Date(timestamp);
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  if (hours < 24) return remainMinutes > 0 ? `${hours} 小时 ${remainMinutes} 分` : `${hours} 小时`;
  const days = Math.floor(hours / 24);
  return `${days} 天`;
}
