import {
  pgTable,
  bigint,
  text,
  integer,
  boolean,
  doublePrecision,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Live cross-device gig feed.
 *
 * A gig is inserted by the Employer device and instantly pushed to every
 * connected Worker device over WebSocket. The primary key is client-provided
 * (a collision-resistant numeric id generated on the posting device) so an
 * optimistic local entry and the broadcast echo reconcile by id without
 * creating duplicate radar pins.
 */
export const gigsTable = pgTable("gigs", {
  id: bigint("id", { mode: "number" }).primaryKey(),
  posisi: text("posisi").notNull(),
  deskripsi: text("deskripsi").notNull().default(""),
  pembayaran: text("pembayaran").notNull(),
  nominal: integer("nominal").notNull(),
  dresscode: text("dresscode").notNull().default(""),
  kuota: integer("kuota").notNull().default(1),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  durasiKontrak: text("durasi_kontrak"),
  namaPerusahaan: text("nama_perusahaan"),
  nibPerusahaan: text("nib_perusahaan"),
  flaggedSuspect: boolean("flagged_suspect").notNull().default(false),
  tipeAkun: text("tipe_akun"),
  isAgency: boolean("is_agency").notNull().default(false),
  hiringMode: text("hiring_mode"),
  broadcastActive: boolean("broadcast_active").notNull().default(false),
  jobDate: timestamp("job_date", { withTimezone: true }),
  jamKerja: text("jam_kerja"),
  alamat: text("alamat"),
  escrowStatus: text("escrow_status"),
  escrowAmount: integer("escrow_amount"),
  /** awaiting_payment -> confirmed; existing pre-pilot gigs default to confirmed. */
  paymentStatus: text("payment_status").notNull().default("confirmed"),
  jumlahHari: integer("jumlah_hari"),
  employerId: text("employer_id"),
  employerName: text("employer_name"),
  // ── Kategori & biaya platform ───────────────────────────────────
  // Fees and worker wages are snapshotted at posting time; neither is derived
  // from a percentage during reporting or payout.
  jobCategory: text("job_category"),
  /** Recruiter-defined application questions shown to applicants per gig. */
  applicationQuestions: jsonb("application_questions")
    .$type<Array<{ id: string; prompt: string; required: boolean; answerType: "short" | "long" | "yes_no" }>>()
    .notNull()
    .default([]),
  /** Documents the recruiter wants applicants to include. */
  requestedApplicationDocuments: jsonb("requested_application_documents")
    .$type<Array<"cv" | "portfolio" | "file" | "photo">>()
    .notNull()
    .default([]),
  adminFeeAmount: integer("admin_fee_amount"),
  totalWorkerPayout: integer("total_worker_payout"),
  // Retained for old client payload compatibility; new financial logic ignores it.
  feeRate: doublePrecision("fee_rate"),
  // ── Borongan workflows ──────────────────────────────────────────
  // "remote" = milestone proof-of-work; "onsite" = daily QR fractional payout.
  boronganType: text("borongan_type"),
  // Remote milestone: the submitted proof-of-work URL (Drive/Figma/GitHub …).
  proofUrl: text("proof_url"),
  // Remote milestone state: "submitted" | "approved" | "rejected".
  proofStatus: text("proof_status"),
  // On-site: how many daily wage fractions have already been released.
  daysPaid: integer("days_paid").notNull().default(0),
  postedAt: timestamp("posted_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertGigSchema = createInsertSchema(gigsTable);
export type InsertGig = z.infer<typeof insertGigSchema>;
export type Gig = typeof gigsTable.$inferSelect;
