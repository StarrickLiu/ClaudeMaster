// 极简 hash 路由
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

  resolve(): void {
    const hash = location.hash.slice(1) || "/dashboard";
    for (const route of this.routes) {
      const match = hash.match(route.pattern);
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
