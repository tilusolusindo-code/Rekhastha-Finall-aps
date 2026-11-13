import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, lte, sql } from "drizzle-orm";
import { db, passwordResetTokensTable, usersTable } from "@workspace/db";
import { logger } from "./logger";

const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 menit
const MAX_ACTIVE_TOKENS = 3; // max token aktif per user

/** Di database hanya disimpan hash token; token asli hanya ada di email pengguna. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Buat reset token baru untuk user berdasarkan email.
 * Mengembalikan token dan userId kalau email ditemukan,
 * null kalau tidak ada (tapi jangan bocorkan ke client).
 */
export async function createPasswordResetToken(
  email: string,
): Promise<{ token: string; userId: string; name: string } | null> {
  const [user] = await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase().trim()))
    .limit(1);

  if (!user) return null;

  // Hapus token lama yang sudah expired
  await db
    .delete(passwordResetTokensTable)
    .where(
      and(
        eq(passwordResetTokensTable.userId, user.id),
        lte(passwordResetTokensTable.expiresAt, sql`now()`),
      ),
    );

  // Batasi jumlah token aktif per user (anti-spam)
  const activeTokens = await db
    .select({ token: passwordResetTokensTable.token })
    .from(passwordResetTokensTable)
    .where(
      and(
        eq(passwordResetTokensTable.userId, user.id),
        gt(passwordResetTokensTable.expiresAt, sql`now()`),
        isNull(passwordResetTokensTable.usedAt),
      ),
    );

  if (activeTokens.length >= MAX_ACTIVE_TOKENS) {
    // Hapus token terlama
    await db
      .delete(passwordResetTokensTable)
      .where(eq(passwordResetTokensTable.token, activeTokens[0].token));
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  await db.insert(passwordResetTokensTable).values({
    token: hashToken(token),
    userId: user.id,
    expiresAt,
  });

  return { token, userId: user.id, name: user.name };
}

/**
 * Verifikasi token dan kembalikan userId kalau valid.
 */
export async function verifyPasswordResetToken(
  token: string,
): Promise<string | null> {
  const [row] = await db
    .select({
      userId: passwordResetTokensTable.userId,
      expiresAt: passwordResetTokensTable.expiresAt,
      usedAt: passwordResetTokensTable.usedAt,
    })
    .from(passwordResetTokensTable)
    .where(eq(passwordResetTokensTable.token, hashToken(token)))
    .limit(1);

  if (!row) return null;
  if (row.usedAt) return null; // sudah dipakai
  if (row.expiresAt <= new Date()) return null; // expired

  return row.userId;
}

/**
 * Klaim token secara atomik (sekali pakai): hanya SATU permintaan yang berhasil
 * walaupun dua permintaan datang bersamaan. Mengembalikan userId bila berhasil.
 * Token reset lain milik user yang sama ikut dihapus.
 */
export async function claimPasswordResetToken(token: string): Promise<string | null> {
  const [row] = await db
    .update(passwordResetTokensTable)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(passwordResetTokensTable.token, hashToken(token)),
        isNull(passwordResetTokensTable.usedAt),
        gt(passwordResetTokensTable.expiresAt, sql`now()`),
      ),
    )
    .returning({ userId: passwordResetTokensTable.userId });
  if (!row) return null;
  await db
    .delete(passwordResetTokensTable)
    .where(and(eq(passwordResetTokensTable.userId, row.userId), isNull(passwordResetTokensTable.usedAt)));
  return row.userId;
}

/**
 * Cleanup token expired — panggil sesekali.
 */
export async function purgeExpiredResetTokens(): Promise<void> {
  await db
    .delete(passwordResetTokensTable)
    .where(lte(passwordResetTokensTable.expiresAt, sql`now()`));
}
