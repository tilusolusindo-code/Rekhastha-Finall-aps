import { recordSecurityEvent } from "./security-events";
/**
 * Global rate limiter untuk semua endpoint /api/*.
 *
 * Strategi: sliding-window counter per IP menggunakan ephemeral_kv
 * yang sudah ada — tidak perlu dependency baru.
 *
 * Default: 60 request per menit per IP.
 * Endpoint auth (/api/auth/*) sudah punya throttle sendiri yang lebih ketat,
 * jadi limiter ini murni untuk endpoint umum seperti GET /gigs, /notifications, dll.
 */

import type { Request, Response, NextFunction } from "express";
import { and, eq, gt, sql } from "drizzle-orm";
import { db, ephemeralKvTable } from "@workspace/db";

const WINDOW_MS = 60_000; // 1 menit
const MAX_REQUESTS = 60;  // maksimum request per IP per window

function getRateLimitKey(req: Request): string {
  // req.ip sudah di-normalize oleh "trust proxy 1" di app.ts
  const ip = req.ip ?? "unknown";
  return `global_rl:${ip}`;
}

/**
 * Increment counter dan kembalikan jumlah request dalam window saat ini.
 * Menggunakan atomic UPSERT di Postgres — aman untuk multi-instance Vercel.
 */
async function incrementCounter(key: string): Promise<number> {
  const expiresAt = new Date(Date.now() + WINDOW_MS);

  // Coba insert baru (pertama dalam window ini)
  const inserted = await db
    .insert(ephemeralKvTable)
    .values({ key, value: { count: 1 }, expiresAt })
    .onConflictDoUpdate({
      target: ephemeralKvTable.key,
      set: {
        value: sql`jsonb_set(
          ${ephemeralKvTable.value},
          '{count}',
          ((${ephemeralKvTable.value}->>'count')::int + 1)::text::jsonb
        )`,
      },
      // Hanya update jika record belum expired; kalau expired biarkan insert menang
      setWhere: gt(ephemeralKvTable.expiresAt, sql`now()`),
    })
    .returning({ value: ephemeralKvTable.value });

  const count = (inserted[0]?.value as { count: number } | undefined)?.count ?? 1;
  return count;
}

export async function globalRateLimit(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // Skip untuk health check & non-API
  if (!req.path.startsWith("/api") || req.path === "/api/health") {
    next();
    return;
  }

  // Skip untuk endpoint auth — sudah punya throttle sendiri yang lebih ketat
  if (req.path.startsWith("/api/auth")) {
    next();
    return;
  }

  try {
    const key = getRateLimitKey(req);
    const count = await incrementCounter(key);

    res.setHeader("X-RateLimit-Limit", MAX_REQUESTS);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, MAX_REQUESTS - count));
    res.setHeader("X-RateLimit-Window", "60s");

    if (count > MAX_REQUESTS) {
      res.setHeader("Retry-After", "60");
      recordSecurityEvent(req, "rate_limited", "warn", `>${MAX_REQUESTS} permintaan/menit`);
      res.status(429).json({
        error: "Terlalu banyak permintaan. Coba lagi dalam 1 menit.",
      });
      return;
    }

    next();
  } catch {
    // Jika DB rate limit gagal (misal DB down), jangan blokir traffic — fail open.
    next();
  }
}
