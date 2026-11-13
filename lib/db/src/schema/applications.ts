import {
  pgTable,
  serial,
  bigint,
  integer,
  text,
  boolean,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Job applications submitted by workers.
 *
 * When a worker taps "Lamar" the row is persisted here and instantly fanned out
 * over the realtime hub so the employer's device receives the application without
 * polling. The worker's sensitive identity fields (NIK, NPWP, rekening) are
 * stored already-masked — masking happens on the worker's device before the
 * payload leaves the browser.
 */
export const applicationsTable = pgTable("applications", {
  id: serial("id").primaryKey(),
  jobId: bigint("job_id", { mode: "number" }).notNull(),
  jobTitle: text("job_title").notNull().default(""),
  workerId: text("worker_id").notNull(),
  /** employer_id from the gigsTable row — used for owner-scoped GET and PATCH authorization. */
  employerId: text("employer_id").notNull().default(""),
  workerName: text("worker_name").notNull().default(""),
  workerNikMasked: text("worker_nik_masked").notNull().default(""),
  workerNpwpMasked: text("worker_npwp_masked").notNull().default(""),
  hasNpwp: boolean("has_npwp").notNull().default(false),
  bank: text("bank").notNull().default(""),
  rekening: text("rekening").notNull().default(""),
  /** Optional CV / portfolio links submitted by the worker. Nullable — many workers won't have them. */
  cvLink: text("cv_link"),
  portfolioLink: text("portfolio_link"),
  /**
   * The CV/Portfolio actually attached to THIS application — either a fresh
   * upload made in the apply modal, or a copy of the worker's profile master
   * files (default_cv_url/default_portfolio_url) resolved at apply time.
   * Regular jobs only; Instant applications never set these.
   */
  submittedCvUrl: text("submitted_cv_url"),
  submittedPortfolioUrl: text("submitted_portfolio_url"),
  /** Immutable copy of the recruiter questions as they appeared at apply time. */
  applicationQuestions: jsonb("application_questions")
    .$type<Array<{ id: string; prompt: string; required: boolean; answerType: "short" | "long" | "yes_no" | "photo" | "file" }>>()
    .notNull()
    .default([]),
  applicationAnswers: jsonb("application_answers")
    .$type<Record<string, string>>()
    .notNull()
    .default({}),
  /** Applicant-provided experience, education, skills, and availability. */
  supportingInfo: jsonb("supporting_info")
    .$type<Record<string, string>>()
    .notNull()
    .default({}),
  /** "baru" (pending) | "ditinjau" | "diterima" | "ditolak" | "selesai" */
  status: text("status").notNull().default("baru"),
  /**
   * Diisi server saat semua hari kerja lengkap (scan masuk + pulang). Terpisah dari status "selesai"
   * (= upah disetujui/dicairkan) supaya pencairan upah tidak terblokir.
   */
  workCompletedAt: timestamp("work_completed_at", { withTimezone: true }),
  /** Diisi saat HR/pemilik memasukkan pelamar ke shortlist untuk ditinjau klien agensi. */
  shortlistedAt: timestamp("shortlisted_at", { withTimezone: true }),
  /** Penilaian klien lewat tautan khusus: "setuju" | "tidak" (hanya saran; keputusan akhir di agensi). */
  clientDecision: text("client_decision"),
  clientNote: text("client_note"),
  clientDecidedAt: timestamp("client_decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  index("applications_worker_created_at_idx").on(table.workerId, table.createdAt),
  index("applications_employer_created_at_idx").on(table.employerId, table.createdAt),
  index("applications_job_worker_created_at_idx").on(
    table.jobId,
    table.workerId,
    table.createdAt,
  ),
]);

/**
 * Private App Storage objects uploaded for one application. The owner can see
 * their own pending uploads; after submission, only that worker and the job's
 * employer can download them through the authenticated file route.
 */
export const applicationUploadsTable = pgTable("application_uploads", {
  id: serial("id").primaryKey(),
  workerId: text("worker_id").notNull(),
  jobId: bigint("job_id", { mode: "number" }).notNull(),
  applicationId: integer("application_id").references(() => applicationsTable.id, { onDelete: "cascade" }),
  objectPath: text("object_path").notNull().unique(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  fileSize: integer("file_size").notNull(),
  kind: text("kind").notNull(),
  /** ID pertanyaan perekrut yang dijawab dengan unggahan ini (null untuk CV/portofolio generik). */
  questionId: text("question_id"),
  uploaded: boolean("uploaded").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  index("application_uploads_application_uploaded_idx").on(
    table.applicationId,
    table.uploaded,
  ),
  index("application_uploads_worker_job_pending_idx").on(
    table.workerId,
    table.jobId,
    table.uploaded,
    table.applicationId,
  ),
]);

export const insertApplicationSchema = createInsertSchema(
  applicationsTable,
).omit({ id: true, status: true, createdAt: true });

export type InsertApplication = z.infer<typeof insertApplicationSchema>;
export type Application = typeof applicationsTable.$inferSelect;
export type ApplicationUpload = typeof applicationUploadsTable.$inferSelect;

/** Tautan khusus agar klien agensi bisa menilai shortlist tanpa akun. Hanya hash token yang disimpan. */
export const clientShareLinksTable = pgTable("client_share_links", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull(),
  jobId: bigint("job_id", { mode: "number" }).notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  label: text("label").notNull().default(""),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
