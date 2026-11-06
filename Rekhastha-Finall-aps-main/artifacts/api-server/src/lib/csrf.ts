import type { RequestHandler } from "express";

/**
 * Defence-in-depth CSRF guard for cookie-authenticated, state-changing calls.
 * Domain utama: rekhastha.my.id
 *
 * `SameSite=Lax` already withholds cookies from cross-site POSTs; this adds a
 * second layer that does not depend on browser cookie behaviour:
 *
 *  - Unsafe methods (POST/PUT/PATCH/DELETE) whose `Origin` header names a
 *    host other than ours (or an entry in ALLOWED_ORIGINS) are rejected.
 *  - If `Origin` is absent, the browser-set `Sec-Fetch-Site: cross-site` is
 *    rejected as well.
 *  - Server-to-server callers (payment webhooks) send neither header and pass.
 *
 * Safe methods never change state in this API (the only cookie-setting GET is
 * the Google OAuth callback, which is protected by its own `state` cookie).
 */
const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function allowedHosts(): Set<string> {
  // Domain produksi selalu diizinkan
  const defaults = ["rekhastha.my.id", "rekhastha-finall-aps.vercel.app"];
  const extra = (process.env["ALLOWED_ORIGINS"] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      try {
        return new URL(value).host;
      } catch {
        return value;
      }
    });
  return new Set([...defaults, ...extra]);
}

export const originGuard: RequestHandler = (req, res, next) => {
  if (process.env["NODE_ENV"] !== "production" || !UNSAFE.has(req.method)) {
    next();
    return;
  }

  const origin = req.headers["origin"];
  const fetchSite = req.headers["sec-fetch-site"];

  if (typeof origin === "string" && origin !== "") {
    let originHost = "";
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = "";
    }
    const requestHost =
      (typeof req.headers["x-forwarded-host"] === "string"
        ? req.headers["x-forwarded-host"].split(",")[0]?.trim()
        : undefined) ?? req.headers.host ?? "";
    if (!originHost || (originHost !== requestHost && !allowedHosts().has(originHost))) {
      res.status(403).json({ error: "Permintaan lintas situs ditolak." });
      return;
    }
  } else if (fetchSite === "cross-site") {
    res.status(403).json({ error: "Permintaan lintas situs ditolak." });
    return;
  }

  next();
};
