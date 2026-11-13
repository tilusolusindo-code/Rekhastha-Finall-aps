import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { revokeAllUserSessions } from "../lib/auth";
import { sendPasswordResetEmail } from "../lib/mailer";
import { keepAlive } from "../lib/vercel-context";
import { eq } from "drizzle-orm";
import {
  createPasswordResetToken,
  verifyPasswordResetToken,
  claimPasswordResetToken,
  purgeExpiredResetTokens,
} from "../lib/password-reset";
import { kvGet, kvPut } from "../lib/ephemeral";

const router: IRouter = Router();

/**
 * Rate limit per IP: maks 5 request reset per 15 menit.
 * Disimpan di ephemeral_kv supaya berlaku di semua instance Vercel.
 */
async function checkResetRateLimit(scopeKey: string, max: number, windowMs: number): Promise<boolean> {
  const key = `reset:limit:${scopeKey}`;
  const count = (await kvGet<number>(key)) ?? 0;
  if (count >= max) return false;
  await kvPut(key, count + 1, windowMs);
  return true;
}

/**
 * POST /api/auth/forgot-password
 * Body: { email }
 * 
 * Selalu kembalikan respons yang sama untuk cegah user enumeration:
 * "Kalau email terdaftar, link reset sudah dikirim."
 * 
 * Token reset HANYA dikirim lewat email (lib/mailer.ts, Resend) dan tidak
 * pernah dikembalikan di respons HTTP.
 */
router.post("/auth/forgot-password", async (req, res): Promise<void> => {
  // `req.ip` honours `trust proxy` (Vercel edge); never trust a raw client header.
  const ip = req.ip ?? "unknown";
  const generic = { ok: true, message: "Jika email terdaftar, tautan reset telah dikirim ke email tersebut." };

  await purgeExpiredResetTokens();

  if (!(await checkResetRateLimit(`ip:${ip}`, 5, 15 * 60 * 1000))) {
    // Same 200 body so the limiter is not an oracle.
    res.json(generic);
    return;
  }

  const parsed = z.object({ email: z.email() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Format email tidak valid." });
    return;
  }
  const email = parsed.data.email.toLowerCase().trim();

  // Per-address cap stops someone from mail-bombing a victim from many IPs.
  if (!(await checkResetRateLimit(`email:${email}`, 3, 60 * 60 * 1000))) {
    res.json(generic);
    return;
  }

  const result = await createPasswordResetToken(email);
  if (result) {
    // The reset secret is delivered ONLY to the mailbox owner. It must never be
    // part of this HTTP response: anyone could otherwise request a token for
    // any email address and take over the account.
    keepAlive(sendPasswordResetEmail(email, result.name, result.token).then(() => undefined));

    // Local development only, when no mail provider is configured.
    if (
      process.env["NODE_ENV"] !== "production" &&
      process.env["DEV_RETURN_RESET_TOKEN"] === "true"
    ) {
      res.json({ ...generic, token: result.token });
      return;
    }
  }

  // Identical body whether or not the email exists (anti user-enumeration).
  res.json(generic);
});

/**
 * POST /api/auth/reset-password
 * Body: { token, newPassword }
 */
router.post("/auth/reset-password", async (req, res): Promise<void> => {
  const parsed = z
    .object({
      token: z.string().min(1),
      newPassword: z.string().min(12, "Kata sandi minimal 12 karakter."),
    })
    .safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Input tidak valid." });
    return;
  }

  // Klaim atomik: dua permintaan bersamaan dengan token yang sama tidak bisa lolos keduanya.
  const userId = await claimPasswordResetToken(parsed.data.token);
  if (!userId) {
    res.status(400).json({ error: "Link reset tidak valid atau sudah kedaluwarsa." });
    return;
  }

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);

  await db
    .update(usersTable)
    .set({ passwordHash, emailVerified: true })
    .where(eq(usersTable.id, userId));

  // Whoever held the old password (or a stolen cookie) is signed out everywhere.
  await revokeAllUserSessions(userId);

  res.json({ ok: true, message: "Kata sandi berhasil diperbarui. Silakan login." });
});

/**
 * GET /api/auth/reset-password/verify?token=...
 * Cek apakah token masih valid sebelum tampilkan form reset.
 */
router.get("/auth/reset-password/verify", async (req, res): Promise<void> => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  if (!token) {
    res.status(400).json({ valid: false, error: "Token diperlukan." });
    return;
  }

  const userId = await verifyPasswordResetToken(token);
  res.json({ valid: !!userId });
});

export default router;
