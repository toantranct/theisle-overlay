/**
 * TheIsle Overlay analytics API.
 *
 * Routing note: `/` and any other path that matches a file in ./public is
 * served as a STATIC ASSET and never reaches this code — those requests are
 * free and unlimited. Only the paths below cost a Worker invocation, which is
 * why the dashboard is a static file that calls /admin/data rather than a
 * server-rendered page.
 */
import { handleAdmin } from "./admin";
import { handleCrash } from "./crash";
import { runCron } from "./cron";
import { handleFeedback } from "./feedback";
import { handlePing } from "./ping";
import type { Env } from "./env";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const path = new URL(req.url).pathname;

    if (req.method === "POST") {
      switch (path) {
        case "/v1/ping":
          return handlePing(req, env);
        case "/v1/feedback":
          return handleFeedback(req, env);
        case "/v1/crash":
          return handleCrash(req, env);
      }
    }
    if (path.startsWith("/admin/")) return handleAdmin(req, env, path);

    return new Response(null, { status: 404 });
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runCron(env).catch((e) => console.error("cron: rollup failed", e)),
    );
  },
};
