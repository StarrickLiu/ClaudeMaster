// 应用启动：注册路由、挂载导航
import { router } from "./router.js";
import "./components/nav-bar.js";
import "./pages/dashboard.js";
import "./pages/sessions.js";
import "./pages/viewer.js";

const app = document.getElementById("app")!;

function setPage(tagName: string, attrs: Record<string, string> = {}) {
  // 更新导航高亮
  const nav = document.querySelector("cm-nav-bar");
  if (nav) {
    const active = tagName.replace("cm-", "").split("-")[0];
    nav.setAttribute("active", active === "viewer" ? "" : active);
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
  container.className = "page-container page";
  container.appendChild(page);
  app.appendChild(container);

  // 滚动到顶部
  window.scrollTo(0, 0);
}

// 注册路由
router.add("/dashboard", () => setPage("cm-dashboard"));
router.add("/sessions", () => setPage("cm-sessions"));
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
