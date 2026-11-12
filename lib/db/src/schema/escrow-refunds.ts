import { bigint, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Kewajiban pengembalian dana ke pemberi kerja. Status "refunded" pada lowongan hanya
 * penanda; baris di sini yang memastikan admin tahu uang siapa, berapa, yang harus
 * ditransfer kembali, dan apakah sudah dilakukan.
 */
export const escrowRefundsTable = pgTable("escrow_refunds", {
  id: serial("id").primaryKey(),
  gigId: bigint("gig_id", { mode: "number" }).notNull().unique(),
  employerId: text("employer_id").notNull(),
  amount: integer("amount").notNull(),
  /** "auto_unused" (otomatis, tidak ada pekerja diterima) | "admin" (keputusan admin). */
  source: text("source").notNull(),
  reason: text("reason").notNull().default(""),
  /** "pending" (belum dikembalikan) -> "paid" (sudah ditransfer). */
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  paidNote: text("paid_note"),
});

export type EscrowRefund = typeof escrowRefundsTable.$inferSelect;
