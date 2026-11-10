import express, { type ErrorRequestHandler, type Express, type RequestHandler } from "express";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import uploadsRouter from "./routes/uploads";
import { logger } from "./lib/logger";
import googleAdminRouter from "./routes/google-admin";
import taxRouter from "./routes/tax";
import teamRouter from "./routes/team";
import { originGuard } from "./lib/csrf";
import { globalRateLimit } from "./lib/global-rate-limit";
import { recordSecurityEvent, suspiciousInputWatcher } from "./lib/security-events";

// ── Simple in-memory rate limiter (no extra package) ─────────────────────────
const rateBuckets = new Map<string, { count: number; reset: number }>();
function rateLimit(maxPerMin: number): RequestHandler {
  return (req, res, next) => {
    // req.ip dinormalisasi oleh "trust proxy" (1 hop Vercel); header X-Forwarded-For
    // mentah bisa dipalsukan penyerang untuk menghindari limit.
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const key = `${req.path}:${ip}`;
    const now = Date.now();
    const bucket = rateBuckets.get(key);
    if (!bucket || now > bucket.reset) {
      rateBuckets.set(key, { count: 1, reset: now + 60_000 });
      return next();
    }
    bucket.count++;
    if (bucket.count > maxPerMin) {
      recordSecurityEvent(req, "rate_limited", "warn", `Melebihi ${maxPerMin}/menit di endpoint sensitif`);
      res.status(429).json({ error: "Terlalu banyak permintaan. Coba lagi dalam 1 menit." });
      return;
    }
    next();
  };
}
// Bersihkan bucket lama setiap 5 menit
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateBuckets) if (now > v.reset) rateBuckets.delete(k);
}, 5 * 60_000).unref();

const app: Express = express();

// All browser traffic is served through the same origin and API prefix, so
// cross-origin access is not part of the product contract.
app.disable("x-powered-by");
// Behind Vercel's edge proxy: trust one hop so req.ip / req.protocol are real.
app.set("trust proxy", 1);
/**
 * Security headers applied to every API response.
 *
 * CSP is strict for API responses (no script/style needed here).
 * The frontend (Vite SPA) has its own CSP via Vercel headers config
 * (see vercel.json), so the API CSP only needs to cover /api/*.
 */
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  // Content-Security-Policy for API responses:
  // No scripts, no frames, no media — API returns JSON only.
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'none'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ].join("; "),
  );

  if (process.env["NODE_ENV"] === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }
  next();
});

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "64kb", parameterLimit: 100 }));

// Catat (tanpa memblokir) input berpola serangan agar terlihat di panel admin.
app.use("/api", suspiciousInputWatcher);

// Reject cross-site state-changing requests before any route runs.
app.use("/api", originGuard);

// Rate limiting pada endpoint sensitif
app.use("/api/auth/login",          rateLimit(10));  // maks 10 login/menit per IP
app.use("/api/auth/avatar",         rateLimit(10));
app.use("/api/auth/account",        rateLimit(20));
app.use("/api/auth/register",       rateLimit(5));   // maks 5 register/menit per IP
app.use("/api/auth/forgot-password", rateLimit(5));   // path sebenarnya (sebelumnya salah: /api/forgot-password)
app.use("/api/auth/reset-password",  rateLimit(10));
app.use("/api/doku/create",         rateLimit(10));  // maks 10 payment attempt/menit
app.use("/api/team/invite",         rateLimit(20));

// Pembatas global (Postgres, dipakai bersama semua instance serverless).
app.use("/api", globalRateLimit);

// Uploaded documents must pass per-file ownership/participant checks.
app.use("/api/uploads", uploadsRouter);
app.use("/api", router);

// Keep unexpected SQL and provider errors out of the default Express error
// handler, which can print raw error messages (including bound query values).
const safeErrorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const rawStatus =
    typeof error === "object" && error !== null && "status" in error &&
    typeof error.status === "number"
      ? error.status
      : undefined;
  const statusCode =
    rawStatus !== undefined && rawStatus >= 400 && rawStatus < 500
      ? rawStatus
      : 500;
  const errorCode =
    typeof error === "object" && error !== null && "code" in error &&
    typeof error.code === "string"
      ? error.code
      : undefined;

  req.log.error({ statusCode, errorCode }, "API request failed");
  if (res.headersSent) {
    res.destroy();
    return;
  }

  res.status(statusCode).json({
    error: statusCode === 500
      ? "Terjadi kesalahan internal."
      : "Permintaan tidak valid.",
  });
};

app.use(safeErrorHandler);

export default app;
