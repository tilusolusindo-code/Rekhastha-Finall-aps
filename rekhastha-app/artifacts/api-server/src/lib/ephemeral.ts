import { and, eq, gt, lte, sql } from "drizzle-orm";
import { db, ephemeralKvTable } from "@workspace/db";

/** Shared, expiring key/value state (see lib/db schema/ephemeral.ts). */

export async function kvPut(key: string, value: unknown, ttlMs: number): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlMs);
  await db
    .insert(ephemeralKvTable)
    .values({ key, value, expiresAt })
    .onConflictDoUpdate({ target: ephemeralKvTable.key, set: { value, expiresAt } });
}

/** Insert only when the key is absent or expired. Returns true if this call won. */
export async function kvPutIfAbsent(key: string, value: unknown, ttlMs: number): Promise<boolean> {
  const expiresAt = new Date(Date.now() + ttlMs);
  const rows = await db
    .insert(ephemeralKvTable)
    .values({ key, value, expiresAt })
    .onConflictDoUpdate({
      target: ephemeralKvTable.key,
      set: { value, expiresAt },
      setWhere: lte(ephemeralKvTable.expiresAt, sql`now()`),
    })
    .returning({ key: ephemeralKvTable.key });
  return rows.length > 0;
}

export async function kvGet<T>(key: string): Promise<T | null> {
  const [row] = await db
    .select({ value: ephemeralKvTable.value })
    .from(ephemeralKvTable)
    .where(and(eq(ephemeralKvTable.key, key), gt(ephemeralKvTable.expiresAt, sql`now()`)))
    .limit(1);
  return (row?.value as T | undefined) ?? null;
}

export async function kvDelete(key: string): Promise<void> {
  await db.delete(ephemeralKvTable).where(eq(ephemeralKvTable.key, key));
}

/**
 * Atomically set `field` to a boolean on a live record, only if it currently
 * differs from `value`. Returns the record when this call flipped the flag.
 * Used as a cross-instance lock (e.g. a QR token being redeemed).
 */
export async function kvClaimFlag<T>(key: string, field: string): Promise<T | null> {
  const rows = await db
    .update(ephemeralKvTable)
    .set({ value: sql`jsonb_set(${ephemeralKvTable.value}, ${sql.raw(`'{${field}}'`)}, 'true'::jsonb)` })
    .where(
      and(
        eq(ephemeralKvTable.key, key),
        gt(ephemeralKvTable.expiresAt, sql`now()`),
        sql`coalesce((${ephemeralKvTable.value} ->> ${sql.raw(`'${field}'`)})::boolean, false) = false`,
      ),
    )
    .returning({ value: ephemeralKvTable.value });
  return (rows[0]?.value as T | undefined) ?? null;
}

export async function kvReleaseFlag(key: string, field: string): Promise<void> {
  await db
    .update(ephemeralKvTable)
    .set({ value: sql`jsonb_set(${ephemeralKvTable.value}, ${sql.raw(`'{${field}}'`)}, 'false'::jsonb)` })
    .where(eq(ephemeralKvTable.key, key));
}

/** Opportunistic cleanup; safe to call occasionally. */
export async function kvPurgeExpired(): Promise<void> {
  await db.delete(ephemeralKvTable).where(lte(ephemeralKvTable.expiresAt, sql`now()`));
}
