import type { IncomingMessage, ServerResponse } from "node:http";
import app from "./app";
import { logger } from "./lib/logger";
import { bootstrapAdminUser } from "./lib/admin";
import { keepAlive } from "./lib/vercel-context";

/**
 * Vercel entrypoint. The platform routes every `/api/*` request to this single
 * function (see build-vercel.mjs) as `/api?__path=<rest>`; the original path is
 * restored here so Express routing sees exactly the URL the browser used.
 */
function restoreOriginalUrl(req: IncomingMessage): void {
  const raw = req.url ?? "/";
  const queryStart = raw.indexOf("?");
  if (queryStart === -1) return;
  const params = new URLSearchParams(raw.slice(queryStart + 1));
  const rest = params.get("__path");
  if (rest === null) return;
  params.delete("__path");
  const remaining = params.toString();
  req.url = `/api/${encodeURI(rest)}${remaining ? `?${remaining}` : ""}`;
}

let bootstrapped = false;
function bootstrapOnce(): void {
  if (bootstrapped) return;
  bootstrapped = true;
  keepAlive(
    bootstrapAdminUser().catch((err: unknown) => {
      logger.error({ err }, "Failed to bootstrap admin user — admin login may not work until resolved.");
    }),
  );
}

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  restoreOriginalUrl(req);
  bootstrapOnce();
  (app as unknown as (req: IncomingMessage, res: ServerResponse) => void)(req, res);
}
