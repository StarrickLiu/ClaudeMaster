// 极简 hash 路由（支持 query string）
type RouteHandler = (params: Record<string, string>) => void;

interface Route {
  pattern: RegExp;
  handler: RouteHandler;
}

class Router {
  private routes: Route[] = [];
  private currentCleanup: (() => void) | null = null;

  add(pattern: string, handler: RouteHandler): void {
    const regex = new RegExp(
      "^" + pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$"
    );
    this.routes.push({ pattern: regex, handler });
  }

  start(): void {
    window.addEventListener("hashchange", () => this.resolve());
    this.resolve();
  }

  /** 解析当前 hash 中的 query string 参数 */
  getQuery(): Record<string, string> {
    const full = location.hash.slice(1) || "";
    const qIdx = full.indexOf("?");
    if (qIdx < 0) return {};
    const params: Record<string, string> = {};
    new URLSearchParams(full.slice(qIdx + 1)).forEach((v, k) => {
      params[k] = v;
    });
    return params;
  }

  resolve(): void {
    const full = location.hash.slice(1) || "/dashboard";
    // 剥离 query string 后再匹配路由
    const qIdx = full.indexOf("?");
    const path = qIdx >= 0 ? full.slice(0, qIdx) : full;
    for (const route of this.routes) {
      const match = path.match(route.pattern);
      if (match) {
        route.handler(match.groups ?? {});
        return;
      }
    }
    // 未匹配则跳转到仪表盘
    location.hash = "#/dashboard";
  }

  navigate(path: string): void {
    location.hash = "#" + path;
  }
}

export const router = new Router();
