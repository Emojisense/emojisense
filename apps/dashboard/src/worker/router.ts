import type { RequestContext } from "./env";

export type Handler = (ctx: RequestContext) => Promise<Response>;

export interface Route {
  method: "GET" | "POST" | "PATCH" | "DELETE" | "OPTIONS";
  /** Path with `:name` segments, e.g. "/api/apps/:id/keys". */
  path: string;
  handler: Handler;
}

interface CompiledRoute extends Route {
  pattern: RegExp;
  names: string[];
}

export type RouteMatch =
  | { kind: "found"; route: Route; params: Record<string, string> }
  | { kind: "wrong_method"; allowed: string[] }
  | { kind: "none" };

/** `undefined` when a segment has broken percent-encoding, which no resource id can contain. */
function decodeParams(names: string[], match: RegExpExecArray): Record<string, string> | undefined {
  try {
    return Object.fromEntries(names.map((name, i) => [name, decodeURIComponent(match[i + 1] ?? "")]));
  } catch {
    return undefined;
  }
}

export function createRouter(routes: Route[]): (method: string, pathname: string) => RouteMatch {
  const compiled: CompiledRoute[] = routes.map((route) => {
    const names: string[] = [];
    const source = route.path.replace(/:(\w+)/g, (_, name: string) => {
      names.push(name);
      return "([^/]+)";
    });
    return { ...route, pattern: new RegExp(`^${source}$`), names };
  });

  return (method, pathname) => {
    const allowed: string[] = [];
    for (const route of compiled) {
      const match = route.pattern.exec(pathname);
      if (!match) continue;
      if (route.method !== method) {
        allowed.push(route.method);
        continue;
      }
      const params = decodeParams(route.names, match);
      return params ? { kind: "found", route, params } : { kind: "none" };
    }
    return allowed.length > 0 ? { kind: "wrong_method", allowed } : { kind: "none" };
  };
}
