import {
  pgTable,
  serial,
  bigint,
  text,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Flat-rate + freemium monetization model (replaces the per-gig escrow/fee
 * model). Reguler postings and applying are always free. Instan Kilat
 * postings are pay-per-post at a flat Rupiah price per category, and an
 * employer's applicant-contact paywall (first 3 free) can be lifted with an
 * active monthly subscription.
 */
export const companySubscriptionsTable = pgTable("company_subscriptions", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().unique(),
  isPremium: boolean("is_premium").notNull().default(false),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertCompanySubscriptionSchema = createInsertSchema(
  companySubscriptionsTable,
).omit({ id: true, createdAt: true });
export type InsertCompanySubscription = z.infer<
  typeof insertCompanySubscriptionSchema
>;
export type CompanySubscription = typeof companySubscriptionsTable.$inferSelect;

/**
 * Matching record for an Instan Kilat gig. Created "pending" at posting, then
 * flipped to "active" only after its manual gig_escrow payment is confirmed;
 * "completed" once a worker successfully claims it via /api/jobs/instant/accept.
 */
export const instantOrdersTable = pgTable("instant_orders", {
  id: serial("id").primaryKey(),
  jobId: bigint("job_id", { mode: "number" }).notNull(),
  companyId: text("company_id").notNull(),
  orderIdGateway: text("order_id_gateway"),
  /** Flat admin-fee snapshot from the gig; this row does not create a payment. */
  amount: integer("amount").notNull(),
  /** "pending" | "active" | "failed" | "completed" */
  status: text("status").notNull().default("pending"),
  matchedApplicantId: text("matched_applicant_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertInstantOrderSchema = createInsertSchema(
  instantOrdersTable,
).omit({ id: true, createdAt: true, status: true, matchedApplicantId: true });
export type InsertInstantOrder = z.infer<typeof insertInstantOrderSchema>;
export type InstantOrder = typeof instantOrdersTable.$inferSelect;
