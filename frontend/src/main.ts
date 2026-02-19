// 应用启动：注册路由、挂载导航
import { router } from "./router.js";
import "./components/nav-bar.js";
import "./pages/dashboard.js";
import "./pages/sessions.js";
import "./pages/viewer.js";
import "./pages/settings.js";
import "./pages/docs.js";

// 初始化主题（尽早执行，避免浅色闪烁）
const savedTheme = localStorage.getItem("cm_theme");
if (savedTheme === "dark") {
  document.documentElement.setAttribute("data-theme", "dark");
}

const app = document.getElementById("app")!;

// 路由 → 导航高亮映射
const activeMap: Record<string, string> = {
  "cm-dashboard": "dashboard",
  "cm-sessions": "sessions",
  "cm-viewer": "",
  "cm-settings": "settings",
  "cm-docs": "docs",
};

function setPage(tagName: string, attrs: Record<string, string> = {}) {
  // 更新导航高亮
  const nav = document.querySelector("cm-nav-bar");
  if (nav) {
    nav.setAttribute("active", activeMap[tagName] ?? "");
  }

  // 渲染页面
  const page = document.createElement(tagName);
  for (const [k, v] of Object.entries(attrs)) {
    page.setAttribute(k, v);
  }

  // 替换页面内容（保留 nav-bar）
  const existing = app.querySelector(".page-container");
  if (existing) existing.remove();

  const container = document.createElement("div");
  // 文档页使用全宽布局，不受 .page 的 max-width 限制
  const isFullWidth = tagName === "cm-docs";
  container.className = isFullWidth ? "page-container page-full" : "page-container page";
  container.appendChild(page);
  app.appendChild(container);

  // 滚动到顶部
  window.scrollTo(0, 0);
}

// 注册路由
router.add("/dashboard", () => setPage("cm-dashboard"));
router.add("/sessions", () => setPage("cm-sessions"));
router.add("/settings", () => setPage("cm-settings"));
router.add("/docs", () => setPage("cm-docs", { page: "overview" }));
router.add("/docs/:page", (params) => setPage("cm-docs", { page: params["page"] }));
router.add("/viewer/:project/:sessionId", (params) =>
  setPage("cm-viewer", {
    project: params["project"],
    sessionId: params["sessionId"],
  })
);

// 插入导航栏
const nav = document.createElement("cm-nav-bar");
app.prepend(nav);

// 启动路由
router.start();
