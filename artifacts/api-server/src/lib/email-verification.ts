import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db, emailVerificationTokensTable } from "@workspace/db";

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 jam
const RESEND_COOLDOWN_MS = 60 * 1000;

const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

/**
 * Buat token verifikasi baru (token lama milik user dihapus). Mengembalikan null bila
 * token terakhir baru dibuat < 60 detik lalu (anti-spam kirim ulang).
 */
export async function createEmailVerificationToken(userId: string): Promise<string | null> {
  const [latest] = await db
    .select({ createdAt: emailVerificationTokensTable.createdAt })
    .from(emailVerificationTokensTable)
    .where(eq(emailVerificationTokensTable.userId, userId))
    .orderBy(desc(emailVerificationTokensTable.createdAt))
    .limit(1);
  if (latest && Date.now() - latest.createdAt.getTime() < RESEND_COOLDOWN_MS) return null;

  await db.delete(emailVerificationTokensTable).where(eq(emailVerificationTokensTable.userId, userId));
  const token = randomBytes(32).toString("base64url");
  await db.insert(emailVerificationTokensTable).values({
    token: hashToken(token),
    userId,
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
  });
  return token;
}

/** Klaim token secara atomik (sekali pakai). Mengembalikan userId bila valid. */
export async function claimEmailVerificationToken(token: string): Promise<string | null> {
  const [row] = await db
    .update(emailVerificationTokensTable)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(emailVerificationTokensTable.token, hashToken(token)),
        isNull(emailVerificationTokensTable.usedAt),
        gt(emailVerificationTokensTable.expiresAt, sql`now()`),
      ),
    )
    .returning({ userId: emailVerificationTokensTable.userId });
  return row?.userId ?? null;
}
