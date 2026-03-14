// 主题管理工具：获取和应用暗色/亮色模式

export function getTheme(): "light" | "dark" {
  return (localStorage.getItem("cm_theme") as "light" | "dark") || "light";
}

export function applyTheme(theme: "light" | "dark"): void {
  document.documentElement.setAttribute("data-theme", theme === "dark" ? "dark" : "");
  localStorage.setItem("cm_theme", theme);
}
