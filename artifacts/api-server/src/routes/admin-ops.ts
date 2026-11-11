import { Router, type IRouter, type Request } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import { db, gigsTable, dailyPayoutsTable, adminLogsTable, radarScrapeAlertsTable, applicationsTable, walletEntriesTable, manualPaymentsTable } from "@workspace/db";
import { ADMIN_COOKIE, isAdminSession, adminSessionId } from "../lib/admin";
import { broadcastGig } from "../lib/realtime";
import { forcePayoutGig } from "../lib/admin-finance";
import { creditedWagesForJob } from "../lib/wage-ledger";

const router: IRouter = Router();

function requireAdmin(req: Request): Promise<boolean> {
  return isAdminSession(req.cookies?.[ADMIN_COOKIE]);
}

async function getAdminId(req: Request): Promise<string | null> {
  return adminSessionId(req.cookies?.[ADMIN_COOKIE]);
}

async function logAdminAction(
  adminId: string,
  action: string,
  targetId?: string | number | null,
  reason?: string | null,
): Promise<void> {
  await db.insert(adminLogsTable).values({
    adminId,
    action,
    targetId: targetId != null ? String(targetId) : null,
    reason: reason ?? null,
  });
}

// ── Pusat Resolusi: remote proof-of-work disputes ────────────────────

/** List every project frozen in `disputed_active` (rejected remote proofs). */
router.get("/admin/disputes", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req))) {
    res.status(401).json({ error: "Sesi admin tidak valid." });
    return;
  }
  const rows = await db
    .select()
    .from(gigsTable)
    .where(eq(gigsTable.escrowStatus, "disputed_active"))
    .orderBy(desc(gigsTable.postedAt));

  res.json(
    rows.map((g) => ({
      jobId: g.id,
      posisi: g.posisi,
      employerId: g.employerId ?? null,
      employerName: g.employerName ?? g.namaPerusahaan ?? "—",
      proofUrl: g.proofUrl ?? null,
      escrowAmount: g.escrowAmount ?? 0,
      workerNet: g.totalWorkerPayout ?? 0,
      postedAt: g.postedAt,
    })),
  );
});

const refundBody = z.object({ jobId: z.coerce.number() });

const refundReasonBody = z.object({ jobId: z.coerce.number(), reason: z.string().min(1, "Alasan wajib diisi.") });

/**
 * Admin rules a dispute in the EMPLOYER's favour → refund the escrow.
 * Audit T3: tidak boleh me-refund lowongan yang upahnya sudah (sebagian)
 * dikreditkan ke wallet pekerja, dan setiap refund wajib tercatat.
 */
router.post("/admin/refund", async (req, res): Promise<void> => {
  const adminId = await getAdminId(req);
  if (!adminId) {
    res.status(401).json({ error: "Sesi admin tidak valid." });
    return;
  }
  const parsed = refundReasonBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Permintaan tidak valid." });
    return;
  }

  const result = await db.transaction(async (tx) => {
    const [gig] = await tx.select().from(gigsTable).where(eq(gigsTable.id, parsed.data.jobId)).for("update").limit(1);
    if (!gig) return { error: "not_found" as const };
    if (!["pending", "processing", "locked", "disputed_active"].includes(gig.escrowStatus ?? "")) {
      return { error: "invalid_status" as const };
    }
    const credited = await creditedWagesForJob(tx, gig.id);
    if (credited > 0) return { error: "already_paid_out" as const };
    const [updated] = await tx
      .update(gigsTable)
      .set({ escrowStatus: "refunded" })
      .where(eq(gigsTable.id, parsed.data.jobId))
      .returning();
    await tx.insert(adminLogsTable).values({
      adminId,
      action: "REFUND_DISPUTE",
      targetId: String(gig.id),
      reason: parsed.data.reason,
    });
    return { gig: updated };
  });

  if ("error" in result) {
    const status = result.error === "not_found" ? 404 : 409;
    res.status(status).json({ error: result.error });
    return;
  }
  broadcastGig(result.gig);
  req.log.info({ jobId: result.gig.id, adminId }, "Admin refunded escrow to employer");
  res.json({ ok: true });
});

// ── Monitoring Proyek Fisik: on-site tracker + daily payout log ──────

router.get("/admin/onsite", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req))) {
    res.status(401).json({ error: "Sesi admin tidak valid." });
    return;
  }

  const gigs = await db
    .select()
    .from(gigsTable)
    .where(eq(gigsTable.boronganType, "onsite"))
    .orderBy(desc(gigsTable.postedAt));

  const ids = gigs.map((g) => g.id);
  const payouts = ids.length
    ? await db
        .select()
        .from(dailyPayoutsTable)
        .where(inArray(dailyPayoutsTable.jobId, ids))
        .orderBy(desc(dailyPayoutsTable.at))
    : [];

  res.json({
    gigs: gigs.map((g) => ({
      jobId: g.id,
      posisi: g.posisi,
      employerName: g.employerName ?? g.namaPerusahaan ?? "—",
      jumlahHari: g.jumlahHari ?? 1,
      daysPaid: g.daysPaid ?? 0,
      escrowAmount: g.escrowAmount ?? 0,
      escrowStatus: g.escrowStatus ?? "locked",
      alamat: g.alamat ?? null,
    })),
    payouts,
  });
});

// ── Job Management: delete, refund, force-payout ──────────────────────

const jobActionBody = z.object({
  reason: z.string().min(1, "Alasan wajib diisi."),
});

/** DELETE /admin/jobs/:id — Remove an inappropriate or fake job posting. */
router.delete("/admin/jobs/:id", async (req, res): Promise<void> => {
  const adminId = await getAdminId(req);
  if (!adminId) {
    res.status(401).json({ error: "Sesi admin tidak valid." });
    return;
  }

  const jobId = Number(req.params["id"]);
  if (!Number.isSafeInteger(jobId) || jobId <= 0) {
    res.status(400).json({ error: "ID job tidak valid." });
    return;
  }

  const parsed = jobActionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Alasan wajib diisi." });
    return;
  }

  // Audit T3: lowongan yang pernah didanai tidak boleh dihapus begitu saja —
  // dana harus di-refund dulu (manual_payments jadi yatim dan uang hilang jika
  // dihapus langsung). ID non-integer juga tidak lagi lolos (Number.isFinite
  // menerima 1.5, sekarang Number.isSafeInteger).
  const result = await db.transaction(async (tx) => {
    const [gig] = await tx.select().from(gigsTable).where(eq(gigsTable.id, jobId)).for("update").limit(1);
    if (!gig) return { error: "not_found" as const };
    if (gig.paymentStatus === "confirmed" && !["refunded", null].includes(gig.escrowStatus)) {
      return { error: "funded" as const };
    }
    await tx.delete(gigsTable).where(eq(gigsTable.id, jobId));
    await tx.insert(adminLogsTable).values({ adminId, action: "DELETE_JOB", targetId: String(jobId), reason: parsed.data.reason });
    return { ok: true as const };
  });

  if ("error" in result) {
    const status = result.error === "not_found" ? 404 : 409;
    const error = result.error === "funded"
      ? "Lowongan ini sudah didanai. Refund dananya terlebih dahulu sebelum menghapus."
      : "Job tidak ditemukan.";
    res.status(status).json({ error });
    return;
  }
  req.log.info({ jobId, adminId }, "Admin deleted job posting");
  res.json({ ok: true });
});

/** POST /admin/jobs/:id/refund — Refund locked escrow back to employer. Satu-satunya jalur refund (audit T3: dua endpoint duplikat sebelumnya). */
router.post("/admin/jobs/:id/refund", async (req, res): Promise<void> => {
  const adminId = await getAdminId(req);
  if (!adminId) {
    res.status(401).json({ error: "Sesi admin tidak valid." });
    return;
  }

  const jobId = Number(req.params["id"]);
  if (!Number.isSafeInteger(jobId) || jobId <= 0) {
    res.status(400).json({ error: "ID job tidak valid." });
    return;
  }

  const parsed = jobActionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Alasan wajib diisi." });
    return;
  }

  const result = await db.transaction(async (tx) => {
    const [gig] = await tx.select().from(gigsTable).where(eq(gigsTable.id, jobId)).for("update").limit(1);
    if (!gig) return { error: "not_found" as const };
    if (!["pending", "processing", "locked", "disputed_active"].includes(gig.escrowStatus ?? "")) {
      return { error: "invalid_status" as const };
    }
    const credited = await creditedWagesForJob(tx, gig.id);
    if (credited > 0) return { error: "already_paid_out" as const };
    const [updated] = await tx
      .update(gigsTable)
      .set({ escrowStatus: "refunded" })
      .where(eq(gigsTable.id, jobId))
      .returning();
    await tx.insert(adminLogsTable).values({ adminId, action: "REFUND_JOB", targetId: String(jobId), reason: parsed.data.reason });
    return { gig: updated };
  });

  if ("error" in result) {
    const status = result.error === "not_found" ? 404 : 409;
    res.status(status).json({ error: result.error });
    return;
  }
  broadcastGig(result.gig);
  req.log.info({ jobId, adminId }, "Admin issued escrow refund for job");
  res.json({ ok: true });
});

/** POST /admin/jobs/:id/force-payout — Emergency release 100% wage to worker. */
router.post("/admin/jobs/:id/force-payout", async (req, res): Promise<void> => {
  const adminId = await getAdminId(req);
  if (!adminId) {
    res.status(401).json({ error: "Sesi admin tidak valid." });
    return;
  }

  const jobId = Number(req.params["id"]);
  if (!Number.isFinite(jobId)) {
    res.status(400).json({ error: "ID job tidak valid." });
    return;
  }

  const parsed = jobActionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Alasan wajib diisi." });
    return;
  }

  const result = await forcePayoutGig(jobId, adminId, parsed.data.reason);
  if (!result.ok) {
    const status = result.error === "not_found" ? 404 : 409;
    res.status(status).json({ error: result.error });
    return;
  }

  req.log.info(
    { jobId, adminId, amount: result.amount, credited: result.credited, duplicate: result.duplicate },
    "Admin force-payout credited worker wallet",
  );
  res.json({
    ok: true,
    amount: result.amount,
    credited: result.credited,
    duplicate: result.duplicate,
  });
});

// ── Admin jobs listing ────────────────────────────────────────────────

/** GET /admin/jobs — All gigs for the job management table. */
router.get("/admin/jobs", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req))) {
    res.status(401).json({ error: "Sesi admin tidak valid." });
    return;
  }

  const gigs = await db
    .select()
    .from(gigsTable)
    .orderBy(desc(gigsTable.postedAt));

  res.json(
    gigs.map((g) => ({
      jobId: g.id,
      posisi: g.posisi,
      employerName: g.employerName ?? g.namaPerusahaan ?? "—",
      escrowAmount: g.escrowAmount ?? 0,
      adminFeeAmount: g.adminFeeAmount ?? 0,
      totalWorkerPayout: g.totalWorkerPayout ?? 0,
      escrowStatus: g.escrowStatus ?? "locked",
      hiringMode: g.hiringMode ?? null,
      postedAt: g.postedAt,
    })),
  );
});

// ── Audit log ─────────────────────────────────────────────────────────

/** GET /admin/logs — Fetch the 200 most-recent admin actions. */
router.get("/admin/logs", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req))) {
    res.status(401).json({ error: "Sesi admin tidak valid." });
    return;
  }

  const logs = await db
    .select()
    .from(adminLogsTable)
    .orderBy(desc(adminLogsTable.createdAt))
    .limit(200);

  res.json(logs);
});

/**
 * GET /admin/radar-alerts — recent flags where a company's usage of the
 * aggregate-only radar-stats endpoint looked like it was probing for
 * individual worker locations (rapid repeated calls or many distinct
 * lat/lng/radius combos in a short window). Informational — nothing is
 * ever blocked automatically.
 */
router.get("/admin/radar-alerts", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req))) {
    res.status(401).json({ error: "Sesi admin tidak valid." });
    return;
  }

  const alerts = await db
    .select()
    .from(radarScrapeAlertsTable)
    .orderBy(desc(radarScrapeAlertsTable.createdAt))
    .limit(200);

  res.json(alerts);
});

export default router;
