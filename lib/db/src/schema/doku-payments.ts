import { pgTable, serial, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Tabel transaksi DOKU Payment Gateway.
 * Satu baris per payment attempt.
 */
export const dokuPaymentsTable = pgTable("doku_payments", {
  id:                   serial("id").primaryKey(),
  orderId:              text("order_id").notNull().unique(),       // RKS-SUB-{id}-{ts}
  subscriptionOrderId:  integer("subscription_order_id"),          // FK ke subscription_orders
  companyId:            text("company_id").notNull(),              // FK ke users
  amount:               integer("amount").notNull(),               // Rupiah, integer
  status:               text("status").notNull().default("pending"), // pending | success | failed
  checkoutUrl:          text("checkout_url"),                       // URL checkout DOKU
  dokuToken:            text("doku_token"),                         // token dari DOKU
  requestId:            text("request_id"),                         // Request-Id header
  transactionStatus:    text("transaction_status"),                 // status raw dari DOKU: SUCCESS|FAILED
  paymentChannel:       text("payment_channel"),                   // VA, QRIS, dll
  notifiedAt:           timestamp("notified_at", { withTimezone: true }),
  createdAt:            timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:            timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDokuPaymentSchema = createInsertSchema(dokuPaymentsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});

export type InsertDokuPayment = z.infer<typeof insertDokuPaymentSchema>;
export type DokuPayment = typeof dokuPaymentsTable.$inferSelect;
