import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Short-lived key/value state shared by every API instance.
 *
 * Serverless functions (Vercel) have no shared memory, so anything that used to
 * live in a module-level Map — attendance QR tokens, Google sign-in handoff
 * codes, radar abuse counters — is stored here with an expiry instead.
 */
export const ephemeralKvTable = pgTable(
  "ephemeral_kv",
  {
    key: text("key").primaryKey(),
    value: jsonb("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("ephemeral_kv_expires_idx").on(table.expiresAt)],
);
