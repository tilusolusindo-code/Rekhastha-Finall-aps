import type { Request, RequestHandler } from "express";
import { lt } from "drizzle-orm";
import { db, securityEventsTable } from "@workspace/db";
import { logger } from "./logger";

export type SecuritySeverity = "info" | "warn" | "high";

export type SecurityEventType =
  | "login_failed"
  | "login_locked"
  | "admin_login_failed"
  | "admin_recovery_failed"
  | "rate_limited"
  | "csrf_blocked"
  | "suspicious_input"
  | "upload_rejected"
  | "malware_detected"
  | "webhook_bad_signature";

const clip = (v: unknown, max: number): string | null =>
  typeof v === "string" && v !== "" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max) : null;

// Cegah satu penyerang membanjiri tabel: maksimal 1 catatan per (ip, jenis) tiap 30 detik.
const lastLogged = new Map<string, number>();
const THROTTLE_MS = 30_000;
setInterval(() => {
  const cutoff = Date.now() - THROTTLE_MS;
  for (const [k, t] of lastLogged) if (t < cutoff) lastLogged.delete(k);
}, 60_000).unref();

/**
 * Catat kejadian keamanan. Tidak pernah melempar error dan tidak menunggu
 * (fire-and-forget) supaya tidak memperlambat atau merusak request asli.
 * JANGAN pernah memasukkan password, token, atau isi body ke `detail`.
 */
export function recordSecurityEvent(
  req: Pick<Request, "ip" | "headers" | "method" | "path"> | null,
  type: SecurityEventType,
  severity: SecuritySeverity,
  detail?: string,
): void {
  try {
    const ip = clip(req?.ip, 64);
    const key = `${ip ?? "?"}:${type}`;
    const now = Date.now();
    const prev = lastLogged.get(key);
    if (prev !== undefined && now - prev < THROTTLE_MS) return;
    lastLogged.set(key, now);

    void db
      .insert(securityEventsTable)
      .values({
        type,
        severity,
        ip,
        userAgent: clip(req?.headers?.["user-agent"], 200),
        method: clip(req?.method, 10),
        path: clip(req?.path, 200),
        detail: clip(detail, 300),
      })
      .then(() => {
        // Simpan 90 hari saja; bersihkan sesekali (±1% kejadian).
        if (Math.random() < 0.01) {
          const cutoff = new Date(Date.now() - 90 * 24 * 3600 * 1000);
          return db.delete(securityEventsTable).where(lt(securityEventsTable.createdAt, cutoff));
        }
        return undefined;
      })
      .catch((err) => logger.warn({ err }, "[security] gagal mencatat kejadian"));

    if (severity === "high") {
      logger.warn({ type, ip, path: req?.path }, "[security] kejadian tingkat tinggi");
    }
  } catch {
    /* pencatatan tidak boleh mengganggu aplikasi */
  }
}

// ── Deteksi pola injeksi pada input (hanya mencatat, TIDAK memblokir) ─────────
// Memblokir berdasarkan pola rawan salah-blokir (mis. nama "O'Brien", teks lowongan).
// Query database sudah aman karena memakai parameter; ini hanya radar untuk admin.
const PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "sql_injection", re: /(\bunion\b[\s\S]{0,20}\bselect\b|\bselect\b[\s\S]{1,40}\bfrom\b[\s\S]{1,40}\b(information_schema|pg_catalog|users)\b|;\s*(drop|truncate|alter)\s+table|\bor\b\s+['"]?\d+['"]?\s*=\s*['"]?\d+|\bpg_sleep\s*\(|\bsleep\s*\(\s*\d+\s*\)|--\s*$)/i },
  { name: "xss", re: /(<\s*script\b|\bon(error|load|click|mouseover)\s*=|javascript\s*:|<\s*iframe\b|<\s*svg[^>]*\bonload)/i },
  { name: "path_traversal", re: /(\.\.[\/\\]|%2e%2e(%2f|%5c)|\/etc\/passwd|\bwin\.ini\b)/i },
  { name: "command_injection", re: /(;|\||&&|\$\()\s*(cat|ls|curl|wget|nc|bash|sh|powershell|whoami)\b/i },
  { name: "nosql_or_proto", re: /(\$where|\$ne\b|__proto__|constructor\.prototype)/i },
];

function scanValue(value: unknown, depth: number, budget: { left: number }): string | null {
  if (budget.left <= 0 || depth > 4) return null;
  budget.left--;
  if (typeof value === "string") {
    const sample = value.length > 2000 ? value.slice(0, 2000) : value;
    for (const p of PATTERNS) if (p.re.test(sample)) return p.name;
    return null;
  }
  if (Array.isArray(value)) {
    for (const v of value.slice(0, 30)) {
      const hit = scanValue(v, depth + 1, budget);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
      if (k === "__proto__" || k === "constructor") return "nosql_or_proto";
      const hit = scanValue(v, depth + 1, budget);
      if (hit) return hit;
    }
  }
  return null;
}

/** Middleware: catat (bukan blokir) input yang berpola serangan umum. */
export const suspiciousInputWatcher: RequestHandler = (req, _res, next) => {
  try {
    // Password/token tidak pernah diperiksa maupun dicatat.
    const body = req.body && typeof req.body === "object" ? { ...(req.body as object) } : req.body;
    if (body && typeof body === "object") {
      for (const k of ["password", "newPassword", "token", "recoveryToken", "signature_key"]) {
        delete (body as Record<string, unknown>)[k];
      }
    }
    const budget = { left: 400 };
    const hit =
      scanValue(req.query, 0, budget) ?? scanValue(req.params, 0, budget) ?? scanValue(body, 0, budget) ??
      scanValue(decodeURIComponentSafe(req.path), 0, budget);
    if (hit) recordSecurityEvent(req, "suspicious_input", "warn", `Pola terdeteksi: ${hit}`);
  } catch {
    /* abaikan */
  }
  next();
};

function decodeURIComponentSafe(v: string): string {
  try { return decodeURIComponent(v); } catch { return v; }
}
