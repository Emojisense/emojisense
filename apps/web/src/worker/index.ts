/**
 * The website's Worker. It runs only for shared playground searches (`run_worker_first` in
 * wrangler.jsonc): every other request is a static asset and never reaches this code.
 */
import type { Env } from "./env";
import { handleQueryCard, handleSharePage } from "./share";

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/s" || pathname === "/s/") return handleSharePage(request, env);
    if (pathname.startsWith("/og/q/")) return handleQueryCard(request, env, ctx);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
