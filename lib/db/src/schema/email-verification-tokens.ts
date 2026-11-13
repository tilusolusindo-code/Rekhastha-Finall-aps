import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/** Token verifikasi email. Yang disimpan hanya hash SHA-256; token asli hanya ada di email pengguna. */
export const emailVerificationTokensTable = pgTable("email_verification_tokens", {
  token: text("token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
