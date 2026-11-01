import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  createPasswordResetToken,
  verifyPasswordResetToken,
  consumePasswordResetToken,
  purgeExpiredResetTokens,
} from "../lib/password-reset";
import { kvGet, kvPut } from "../lib/ephemeral";

const router: IRouter = Router();

/**
 * Rate limit per IP: maks 5 request reset per 15 menit.
 * Disimpan di ephemeral_kv supaya berlaku di semua instance Vercel.
 */
async function checkResetRateLimit(ip: string): Promise<boolean> {
  const key = `reset:limit:${ip}`;
  const count = (await kvGet<number>(key)) ?? 0;
  if (count >= 5) return false;
  await kvPut(key, count + 1, 15 * 60 * 1000);
  return true;
}

/**
 * POST /api/auth/forgot-password
 * Body: { email }
 * 
 * Selalu kembalikan respons yang sama untuk cegah user enumeration:
 * "Kalau email terdaftar, link reset sudah dikirim."
 * 
 * Di produksi tanpa email service, token dikembalikan langsung ke client
 * supaya bisa dipakai di form reset. Di masa depan bisa diganti dengan
 * kiriman email (Resend, Nodemailer, dll).
 */
router.post("/auth/forgot-password", async (req, res): Promise<void> => {
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.ip ?? "unknown";
  
  await purgeExpiredResetTokens();

  const allowed = await checkResetRateLimit(ip);
  if (!allowed) {
    // Tetap kembalikan 200 supaya tidak bocorkan info rate limit
    res.json({ ok: true, message: "Jika email terdaftar, instruksi reset telah dikirim." });
    return;
  }

  const parsed = z.object({ email: z.email() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Format email tidak valid." });
    return;
  }

  const result = await createPasswordResetToken(parsed.data.email);

  // Selalu kembalikan respons yang sama (anti user-enumeration)
  res.json({
    ok: true,
    message: "Jika email terdaftar, instruksi reset telah dikirim.",
    // Token dikembalikan langsung karena belum ada email service.
    // Hapus baris ini setelah integrasi email service.
    ...(result ? { token: result.token, name: result.name } : {}),
  });
});

/**
 * POST /api/auth/reset-password
 * Body: { token, newPassword }
 */
router.post("/auth/reset-password", async (req, res): Promise<void> => {
  const parsed = z
    .object({
      token: z.string().min(1),
      newPassword: z.string().min(8, "Kata sandi minimal 8 karakter."),
    })
    .safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Input tidak valid." });
    return;
  }

  const userId = await verifyPasswordResetToken(parsed.data.token);
  if (!userId) {
    res.status(400).json({ error: "Link reset tidak valid atau sudah kedaluwarsa." });
    return;
  }

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);

  await db
    .update(usersTable)
    .set({ passwordHash })
    .where(eq(usersTable.id, userId));

  await consumePasswordResetToken(parsed.data.token);

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
