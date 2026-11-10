import { recordSecurityEvent } from "./security-events";
/**
 * Pembatas laju global untuk semua endpoint /api/*.
 *
 * Counter per IP disimpan di Postgres (ephemeral_kv) dengan satu UPSERT atomik,
 * sehingga berlaku lintas instance serverless Vercel (berbeda dengan Map di memori).
 *
 * Dipasang di app.ts lewat `app.use("/api", globalRateLimit)`, jadi `req.path`
 * di sini RELATIF terhadap /api (mis. "/gigs", bukan "/api/gigs").
 *
 * Batas sengaja longgar (aplikasi SPA melakukan banyak GET & polling); tujuannya
 * menahan pemindaian/scraping, bukan pemakaian normal. Endpoint sensitif punya
 * pembatas yang lebih ketat sendiri di app.ts.
 */

import type { Request, Response, NextFunction } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

const WINDOW_MS = 60_000; // 1 menit
const MAX_REQUESTS = Number(process.env["GLOBAL_RATE_LIMIT_PER_MIN"]) || 300;

// Path (relatif /api) yang tidak dibatasi global.
function isExempt(path: string): boolean {
  return (
    path === "/health" ||
    path === "/healthz" ||
    path.startsWith("/auth") || // punya throttle sendiri yang lebih ketat
    path.startsWith("/payments/midtrans/notification") // webhook server-ke-server
  );
}

function getRateLimitKey(req: Request): string {
  // req.ip sudah dinormalisasi oleh "trust proxy" di app.ts.
  return `global_rl:${req.ip ?? "unknown"}`;
}

/**
 * Naikkan counter dan kembalikan jumlah request pada window saat ini.
 * Jika baris lama sudah kedaluwarsa, window dimulai ulang (count = 1).
 */
async function incrementCounter(key: string): Promise<number> {
  const expiresAt = new Date(Date.now() + WINDOW_MS);
  const result = await db.execute<{ count: number }>(sql`
    INSERT INTO ephemeral_kv (key, value, expires_at)
    VALUES (${key}, '{"count":1}'::jsonb, ${expiresAt})
    ON CONFLICT (key) DO UPDATE SET
      value = CASE
        WHEN ephemeral_kv.expires_at <= now() THEN '{"count":1}'::jsonb
        ELSE jsonb_set(
          ephemeral_kv.value,
          '{count}',
          to_jsonb(COALESCE((ephemeral_kv.value->>'count')::int, 0) + 1)
        )
      END,
      expires_at = CASE
        WHEN ephemeral_kv.expires_at <= now() THEN EXCLUDED.expires_at
        ELSE ephemeral_kv.expires_at
      END
    RETURNING (value->>'count')::int AS count
  `);
  const row = (result as unknown as { rows?: Array<{ count: number }> }).rows?.[0]
    ?? (Array.isArray(result) ? (result as Array<{ count: number }>)[0] : undefined);
  return Number(row?.count ?? 1);
}

export async function globalRateLimit(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (isExempt(req.path)) {
    next();
    return;
  }

  try {
    const count = await incrementCounter(getRateLimitKey(req));

    res.setHeader("X-RateLimit-Limit", MAX_REQUESTS);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, MAX_REQUESTS - count));
    res.setHeader("X-RateLimit-Window", "60s");

    if (count > MAX_REQUESTS) {
      res.setHeader("Retry-After", "60");
      recordSecurityEvent(req, "rate_limited", "warn", `>${MAX_REQUESTS} permintaan/menit (global)`);
      res.status(429).json({
        error: "Terlalu banyak permintaan. Coba lagi dalam 1 menit.",
      });
      return;
    }
  } catch {
    // Jika DB pembatas gagal (mis. DB down), jangan blokir trafik — fail open.
  }
  next();
}
