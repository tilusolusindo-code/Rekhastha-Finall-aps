import { randomUUID, timingSafeEqual } from "node:crypto";
import type { CookieOptions } from "express";
import { and, eq, lte } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, adminUsersTable, adminSessionsTable, adminLoginAttemptsTable } from "@workspace/db";

/**
 * Admin ("Tilu Saudara Solusindo") control-plane auth. Deliberately separate from the
 * user session system: a distinct httpOnly cookie, a Postgres-backed session
 * store, and per-IP brute-force throttling.
 *
 * Credentials are now stored in `admin_users` (bcrypt hashes) so the operator
 * can change their own password via the portal without editing env secrets.
 * The ADMIN_TOKEN env secret is kept as a one-time recovery key only.
 *
 * On first startup (empty admin_users) the table is seeded automatically from
 * ADMIN_ID / ADMIN_TOKEN env secrets (or the dev fallbacks in non-production).
 */
export const ADMIN_COOKIE = "rekhastha_admin";
const ADMIN_TTL_MS = 1000 * 60 * 60 * 8; // 8 hours

/**
 * Returns the configured admin ID and recovery key. There are no source-code
 * fallback credentials; the recovery key is not used as the everyday password.
 */
export function adminCredentials(): { id: string; token: string } | null {
  const id = process.env["ADMIN_ID"]?.trim();
  const token = process.env["ADMIN_TOKEN"]?.trim();

  if (id && token) {
    return { id, token };
  }

  return null;
}

/**
 * Kept as a startup hook for existing deployments. Empty admin tables are
 * provisioned through the recovery flow so the recovery key is never silently
 * used as an everyday admin password.
 */
export async function bootstrapAdminUser(): Promise<void> {
  // Do not seed a password from the recovery key. The first admin account is
  // created explicitly through the recovery form with a user-chosen password.
}

/**
 * DB-backed credential check. Replaces the old synchronous env comparison.
 */
export async function verifyAdminPassword(adminId: string, password: string): Promise<boolean> {
  const [row] = await db
    .select({ passwordHash: adminUsersTable.passwordHash })
    .from(adminUsersTable)
    .where(eq(adminUsersTable.adminId, adminId))
    .limit(1);

  if (!row) return false;
  return bcrypt.compare(password, row.passwordHash);
}

/**
 * Change password for a logged-in admin. Requires the old password for
 * verification before updating.
 */
export async function changeAdminPassword(
  adminId: string,
  oldPassword: string,
  newPassword: string,
): Promise<{ ok: true } | { error: string }> {
  const valid = await verifyAdminPassword(adminId, oldPassword);
  if (!valid) return { error: "Kata sandi lama tidak sesuai." };

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await db
    .update(adminUsersTable)
    .set({ passwordHash, mustChangePassword: false, updatedAt: new Date() })
    .where(eq(adminUsersTable.adminId, adminId));

  return { ok: true };
}

function matchesRecoveryKey(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer);
}

/**
 * Recover the sole admin account using the configured ADMIN_TOKEN recovery
 * key. The account is renamed to the configured ADMIN_ID, its password is
 * bcrypt-hashed, and all of its existing sessions are revoked.
 */
export async function resetAdminPassword(
  newPassword: string,
  recoveryToken: string,
): Promise<{ ok: true; adminId: string } | { error: string }> {
  const creds = adminCredentials();
  if (!creds || !matchesRecoveryKey(recoveryToken, creds.token)) {
    return { error: "Token pemulihan tidak valid." };
  }

  const admins = await db
    .select({ adminId: adminUsersTable.adminId })
    .from(adminUsersTable);
  const existingTarget = admins.find((row) => row.adminId === creds.id);

  if (admins.length > 1 && !existingTarget) {
    return {
      error: "Pemulihan otomatis hanya tersedia untuk satu akun admin. Hubungi pemilik sistem untuk memeriksa akun admin tambahan.",
    };
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  const sourceAdminId = existingTarget?.adminId ?? (admins.length === 1 ? admins[0]?.adminId : undefined);

  await db.transaction(async (tx) => {
    if (sourceAdminId) {
      await tx
        .delete(adminSessionsTable)
        .where(eq(adminSessionsTable.adminId, sourceAdminId));
      await tx
        .update(adminUsersTable)
        .set({
          adminId: creds.id,
          passwordHash,
          mustChangePassword: false,
          updatedAt: new Date(),
        })
        .where(eq(adminUsersTable.adminId, sourceAdminId));
      return;
    }

    await tx.insert(adminUsersTable).values({
      adminId: creds.id,
      passwordHash,
      displayName: "Tilu Admin",
      mustChangePassword: false,
    });
  });

  return { ok: true, adminId: creds.id };
}

export function adminCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env["NODE_ENV"] === "production",
    path: "/",
    maxAge: ADMIN_TTL_MS,
  };
}

// ── Postgres-backed admin session store ──────────────────────────
export async function createAdminSession(adminId: string): Promise<string> {
  const token = randomUUID();
  await db.insert(adminSessionsTable).values({
    token,
    adminId,
    expiresAt: new Date(Date.now() + ADMIN_TTL_MS),
  });
  return token;
}

export async function isAdminSession(token: string | undefined): Promise<boolean> {
  return (await adminSessionId(token)) !== null;
}

/** Returns the admin id bound to a live session, or null if invalid/expired. */
export async function adminSessionId(
  token: string | undefined,
): Promise<string | null> {
  if (!token) return null;
  const [session] = await db
    .select()
    .from(adminSessionsTable)
    .where(eq(adminSessionsTable.token, token))
    .limit(1);
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) {
    await db.delete(adminSessionsTable).where(eq(adminSessionsTable.token, token));
    return null;
  }
  return session.adminId;
}

export async function deleteAdminSession(token: string | undefined): Promise<void> {
  if (token) {
    await db.delete(adminSessionsTable).where(eq(adminSessionsTable.token, token));
  }
}

// ── Postgres-backed per-IP brute-force throttle ──────────────────
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 1000 * 60 * 5; // 5 minutes

/** Returns the remaining lockout in ms, or 0 if the caller may attempt. */
export async function lockoutRemaining(ip: string): Promise<number> {
  const [rec] = await db
    .select()
    .from(adminLoginAttemptsTable)
    .where(eq(adminLoginAttemptsTable.ip, ip))
    .limit(1);
  if (!rec || !rec.lockedUntil) return 0;
  const remaining = rec.lockedUntil.getTime() - Date.now();
  return remaining > 0 ? remaining : 0;
}

export async function recordFailedAttempt(ip: string): Promise<void> {
  const [rec] = await db
    .select()
    .from(adminLoginAttemptsTable)
    .where(eq(adminLoginAttemptsTable.ip, ip))
    .limit(1);

  const count = (rec?.count ?? 0) + 1;
  const now = new Date();

  if (count >= MAX_ATTEMPTS) {
    const values = {
      ip,
      count: 0,
      lockedUntil: new Date(Date.now() + LOCKOUT_MS),
      updatedAt: now,
    };
    await db
      .insert(adminLoginAttemptsTable)
      .values(values)
      .onConflictDoUpdate({
        target: adminLoginAttemptsTable.ip,
        set: { count: values.count, lockedUntil: values.lockedUntil, updatedAt: now },
      });
    return;
  }

  await db
    .insert(adminLoginAttemptsTable)
    .values({ ip, count, lockedUntil: null, updatedAt: now })
    .onConflictDoUpdate({
      target: adminLoginAttemptsTable.ip,
      set: { count, lockedUntil: null, updatedAt: now },
    });
}

export async function resetAttempts(ip: string): Promise<void> {
  await db.delete(adminLoginAttemptsTable).where(eq(adminLoginAttemptsTable.ip, ip));
}

/**
 * Best-effort cleanup of expired sessions and stale, expired lockout rows.
 * Called opportunistically from the login path; not on the hot read path.
 */
export async function pruneAdminState(): Promise<void> {
  const now = new Date();
  await db.delete(adminSessionsTable).where(lte(adminSessionsTable.expiresAt, now));
  await db
    .delete(adminLoginAttemptsTable)
    .where(
      and(
        lte(adminLoginAttemptsTable.lockedUntil, now),
        eq(adminLoginAttemptsTable.count, 0),
      ),
    );
}
