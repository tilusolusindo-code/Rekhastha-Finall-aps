import { Router, type IRouter } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  gigsTable,
  dailyPayoutsTable,
  attendanceTable,
  applicationsTable,
  walletEntriesTable,
  usersTable,
} from "@workspace/db";
import { getSessionUser, SESSION_COOKIE } from "../lib/auth";
import { calculateTotalWorkerPayout } from "../lib/pricing";
import { creditedWagesForJob, escrowAllowsPayout } from "../lib/wage-ledger";
import { broadcastGig, broadcastDailyPayout } from "../lib/realtime";

const router: IRouter = Router();

/**
 * The admin fee is billed separately from wages. `dailyFractionFor` splits the
 * saved worker-wage snapshot across the contract duration and settles any
 * rounding remainder on the FINAL day. `dayIndex` is 1-based.
 */
function dailyFractionFor(
  workerWageTotal: number,
  days: number,
  dayIndex: number,
): { grossFraction: number; platformFee: number; netToWorker: number } {
  const d = Math.max(1, days);
  const perDayNet = Math.floor(workerWageTotal / d);
  const isFinal = dayIndex >= d;
  const netToWorker = isFinal ? workerWageTotal - perDayNet * (d - 1) : perDayNet;
  return { grossFraction: netToWorker, platformFee: 0, netToWorker };
}

// ── Borongan Jarak Jauh (Remote milestone proof-of-work) ─────────────

const submitBody = z.object({
  jobId: z.coerce.number(),
  proofUrl: z.string().url().refine(
    (u) => u.startsWith("https://") || u.startsWith("http://"),
    { message: "URL bukti kerja harus menggunakan protokol http atau https." },
  ),
});

/** Worker submits a proof-of-work URL to claim milestone payment. */
router.post("/borongan/remote/submit-proof", async (req, res): Promise<void> => {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user) {
    res.status(401).json({ error: "Tidak terautentikasi." });
    return;
  }
  if (user.role !== "pekerja") {
    res.status(403).json({ error: "Hanya pekerja yang ditugaskan dapat mengirim bukti kerja." });
    return;
  }
  const parsed = submitBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db
    .select()
    .from(gigsTable)
    .where(eq(gigsTable.id, parsed.data.jobId));
  if (!existing) {
    res.status(404).json({ error: "Proyek tidak ditemukan." });
    return;
  }
  const [acceptedApplication] = await db
    .select({ id: applicationsTable.id })
    .from(applicationsTable)
    .where(
      and(
        eq(applicationsTable.jobId, parsed.data.jobId),
        eq(applicationsTable.workerId, user.id),
        eq(applicationsTable.status, "diterima"),
      ),
    )
    .limit(1);
  if (!acceptedApplication) {
    res.status(403).json({ error: "Bukti kerja hanya dapat dikirim oleh pekerja yang diterima pada proyek ini." });
    return;
  }
  // A finalized milestone (already paid out) must not be re-opened by a new proof.
  if (existing.proofStatus === "approved" || existing.escrowStatus === "released") {
    res.status(409).json({ error: "Proyek sudah selesai dan tidak dapat diajukan ulang." });
    return;
  }

  const [gig] = await db
    .update(gigsTable)
    .set({
      proofUrl: parsed.data.proofUrl,
      proofStatus: "submitted",
      proofSubmittedBy: user.id,
      boronganType: "remote",
    })
    .where(eq(gigsTable.id, parsed.data.jobId))
    .returning();

  broadcastGig(gig);
  req.log.info({ jobId: gig.id }, "Remote borongan proof submitted");
  res.json(gig);
});

const decisionBody = z.object({ jobId: z.coerce.number() });

async function loadOwnedGig(
  jobId: number,
  employerId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const [gig] = await db.select().from(gigsTable).where(eq(gigsTable.id, jobId));
  if (!gig) return { ok: false, status: 404, error: "Proyek tidak ditemukan." };
  // Ownership must be positively verifiable: a gig with no recorded employer
  // cannot be approved/rejected by anyone (prevents IDOR escrow manipulation).
  if (!gig.employerId || gig.employerId !== employerId) {
    return { ok: false, status: 403, error: "Hanya pemberi kerja pemilik proyek yang dapat memutuskan." };
  }
  if (gig.paymentStatus !== "confirmed" || !escrowAllowsPayout(gig.escrowStatus)) {
    return { ok: false, status: 409, error: "Pembayaran proyek belum dikonfirmasi admin, atau sedang disengketakan/direfund." };
  }
  return { ok: true };
}

async function workerIsVerified(workerId: string): Promise<boolean> {
  const [worker] = await db
    .select({ verificationStatus: usersTable.verificationStatus })
    .from(usersTable)
    .where(eq(usersTable.id, workerId))
    .limit(1);
  return worker?.verificationStatus === "verified";
}

/**
 * Employer approves the proof and credits the saved wage amount to the worker.
 */
router.post("/borongan/remote/approve", async (req, res): Promise<void> => {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user) {
    res.status(401).json({ error: "Tidak terautentikasi." });
    return;
  }
  const parsed = decisionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "jobId tidak valid." });
    return;
  }
  const owned = await loadOwnedGig(parsed.data.jobId, user.id);
  if (!owned.ok) {
    res.status(owned.status).json({ error: owned.error });
    return;
  }

  // Dibayar adalah pekerja yang MENGIRIM bukti, bukan "pelamar diterima pertama"
  // tanpa urutan (audit T2). proofSubmittedBy diisi saat submit-proof.
  const [currentGig] = await db
    .select()
    .from(gigsTable)
    .where(eq(gigsTable.id, parsed.data.jobId))
    .limit(1);
  if (!currentGig || currentGig.proofStatus !== "submitted" || !currentGig.proofSubmittedBy) {
    res.status(409).json({ error: "Bukti kerja belum menunggu persetujuan." });
    return;
  }
  const [application] = await db
    .select()
    .from(applicationsTable)
    .where(
      and(
        eq(applicationsTable.jobId, parsed.data.jobId),
        eq(applicationsTable.workerId, currentGig.proofSubmittedBy),
        eq(applicationsTable.status, "diterima"),
      ),
    )
    .limit(1);
  if (!application) {
    res.status(409).json({ error: "Pekerja pengirim bukti tidak lagi berstatus diterima." });
    return;
  }
  if (!(await workerIsVerified(application.workerId))) {
    res.status(409).json({ error: "Pekerja ini belum lolos verifikasi KYC." });
    return;
  }
  const workerCount = Math.max(1, currentGig.kuota ?? 1);
  const expectedTotal = calculateTotalWorkerPayout(
    currentGig.nominal,
    currentGig.pembayaran,
    currentGig.jumlahHari,
    workerCount,
  );
  const totalWorkerPayout = currentGig.totalWorkerPayout ?? expectedTotal;
  const amount = totalWorkerPayout / workerCount;
  if (
    totalWorkerPayout !== expectedTotal ||
    !Number.isSafeInteger(totalWorkerPayout) ||
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    (currentGig.escrowAmount ?? 0) < totalWorkerPayout
  ) {
    res.status(409).json({ error: "Snapshot upah atau dana proyek tidak valid." });
    return;
  }
  const result = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select({
        id: gigsTable.id,
        proofStatus: gigsTable.proofStatus,
        totalWorkerPayout: gigsTable.totalWorkerPayout,
        escrowStatus: gigsTable.escrowStatus,
        paymentStatus: gigsTable.paymentStatus,
      })
      .from(gigsTable)
      .where(eq(gigsTable.id, parsed.data.jobId))
      .for("update")
      .limit(1);
    if (!locked || locked.proofStatus !== "submitted") return { error: "not_pending" as const };
    // Cek ulang SETELAH mengunci baris: refund/sengketa bisa terjadi sejak pengecekan awal.
    if (locked.paymentStatus !== "confirmed" || !escrowAllowsPayout(locked.escrowStatus)) {
      return { error: "not_pending" as const };
    }
    const alreadyCredited = await creditedWagesForJob(tx, parsed.data.jobId);
    if (alreadyCredited + amount > (locked.totalWorkerPayout ?? 0)) {
      return { error: "budget_exceeded" as const };
    }
    const [gig] = await tx
      .update(gigsTable)
      .set({ proofStatus: "approved", escrowStatus: "released" })
      .where(eq(gigsTable.id, parsed.data.jobId))
      .returning();
    await tx
      .insert(walletEntriesTable)
      .values({
        workerId: application.workerId,
        sourceType: "remote_borongan",
        sourceId: String(gig.id),
        amount,
        description: `Upah proyek: ${gig.posisi}`,
      })
      .onConflictDoNothing();
    return { gig };
  });
  if ("error" in result) {
    res.status(409).json({ error: result.error === "not_pending" ? "Bukti kerja tidak lagi menunggu persetujuan." : "Dana proyek tidak mencukupi." });
    return;
  }

  broadcastGig(result.gig);
  req.log.info({ jobId: result.gig.id, workerId: application.workerId }, "Remote borongan approved and credited to wallet");
  res.json({ ...result.gig, payoutStatus: "available_for_manual_withdrawal" });
});

/**
 * Employer REJECTS the proof: the project freezes into `disputed_active` and is
 * routed to the Admin "Pusat Resolusi" for a manual ruling.
 */
router.post("/borongan/remote/reject", async (req, res): Promise<void> => {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user) {
    res.status(401).json({ error: "Tidak terautentikasi." });
    return;
  }
  const parsed = decisionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "jobId tidak valid." });
    return;
  }
  const owned = await loadOwnedGig(parsed.data.jobId, user.id);
  if (!owned.ok) {
    res.status(owned.status).json({ error: owned.error });
    return;
  }

  // Hanya bukti yang sedang menunggu yang boleh ditolak (audit T2): mencegah
  // reject sebelum ada bukti, atau setelah upah sudah dibayar (approved).
  const [gig] = await db
    .update(gigsTable)
    .set({ proofStatus: "rejected", escrowStatus: "disputed_active" })
    .where(and(eq(gigsTable.id, parsed.data.jobId), eq(gigsTable.proofStatus, "submitted")))
    .returning();
  if (!gig) {
    res.status(409).json({ error: "Bukti kerja tidak dalam status menunggu persetujuan." });
    return;
  }

  broadcastGig(gig);
  req.log.warn({ jobId: gig.id }, "Remote borongan proof rejected → disputed_active");
  res.json(gig);
});

// ── Borongan Di Tempat (On-site daily QR fractional payout) ──────────

/** Returns today's date as "YYYY-MM-DD" in the Asia/Jakarta timezone. */
function jakartaDateString(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
}

const checkoutBody = z.object({ jobId: z.coerce.number() });

/**
 * Worker performs a verified daily QR check-out on an on-site borongan. One
 * day's fraction of the saved worker wage is released to the worker and logged
 * for audit. The flat admin fee is a separate employer charge.
 *
 * Pre-condition: the worker must have a "masuk" (check-in) attendance record
 * for this job today. Without it the checkout is blocked with 403.
 */
router.post("/borongan/onsite/checkout", async (req, res): Promise<void> => {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user) {
    res.status(401).json({ error: "Tidak terautentikasi." });
    return;
  }
  const parsed = checkoutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "jobId tidak valid." });
    return;
  }

  // Attendance pre-condition: a "masuk" scan must exist for this worker today
  // before any escrow fraction can be released. This prevents a worker from
  // calling checkout without ever having QR-scanned in on site.
  const today = jakartaDateString();
  const [checkIn] = await db
    .select({ id: attendanceTable.id })
    .from(attendanceTable)
    .where(
      and(
        eq(attendanceTable.jobId, parsed.data.jobId),
        eq(attendanceTable.workerId, user.id),
        eq(attendanceTable.kind, "masuk"),
        eq(attendanceTable.scanDate, today),
      ),
    )
    .limit(1);

  if (!checkIn) {
    res.status(403).json({
      error:
        "Kamu belum scan presensi masuk hari ini. Minta employer tampilkan QR masuk terlebih dahulu.",
    });
    return;
  }

  // Read-modify-write under a row lock inside a single transaction so two
  // concurrent check-outs can never pay the same day twice or overshoot the
  // contract duration.
  //
  // Per-day dedup: a "pulang" attendance record is inserted atomically inside
  // the transaction. If the DB unique constraint on (jobId, workerId, kind,
  // scanDate) fires (concurrent or repeated request), onConflictDoNothing
  // returns an empty array → 409. This is the authoritative guard; the row is
  // also the audit trail for today's check-out.
  const outcome = await db.transaction(async (tx) => {
    const [gig] = await tx
      .select()
      .from(gigsTable)
      .where(eq(gigsTable.id, parsed.data.jobId))
      .for("update");
    if (!gig) return { status: 404 as const, error: "Proyek tidak ditemukan." };

    if (gig.paymentStatus !== "confirmed") {
      return { status: 409 as const, error: "Pembayaran proyek belum dikonfirmasi admin." };
    }
    // Dana yang sudah dikembalikan / sedang disengketakan tidak boleh dibayarkan ke pekerja.
    if (!escrowAllowsPayout(gig.escrowStatus)) {
      return { status: 409 as const, error: "Dana proyek ini tidak dapat dicairkan (dikembalikan atau sedang sengketa)." };
    }
    const totalDays = gig.jumlahHari ?? 1;
    const workerCount = Math.max(1, gig.kuota ?? 1);
    const expectedTotalWages = calculateTotalWorkerPayout(
      gig.nominal,
      gig.pembayaran,
      totalDays,
      workerCount,
    );
    const totalWorkerPayout = gig.totalWorkerPayout ?? expectedTotalWages;
    const totalDeposit = gig.escrowAmount ?? 0;
    const workerWageTotal = totalWorkerPayout / workerCount;
    if (
      totalWorkerPayout !== expectedTotalWages ||
      !Number.isSafeInteger(totalWorkerPayout) ||
      !Number.isSafeInteger(workerWageTotal) ||
      workerWageTotal <= 0 ||
      totalDeposit < totalWorkerPayout
    ) {
      return { status: 409 as const, error: "Snapshot upah atau dana proyek tidak valid." };
    }

    // Pelamar harus diterima dan lolos KYC sebelum menerima upah harian (audit K1/T1).
    const [acceptedApplication] = await tx
      .select({ id: applicationsTable.id })
      .from(applicationsTable)
      .where(and(
        eq(applicationsTable.jobId, gig.id),
        eq(applicationsTable.workerId, user.id),
        eq(applicationsTable.status, "diterima"),
      ))
      .limit(1);
    if (!acceptedApplication) {
      return { status: 403 as const, error: "Kamu bukan pekerja yang diterima pada proyek ini." };
    }
    if (!(await workerIsVerified(user.id))) {
      return { status: 403 as const, error: "Verifikasi KYC kamu belum disetujui admin." };
    }

    // Progres dihitung PER PEKERJA dari jumlah hari yang sudah dibayar ke pekerja
    // ini (audit T1: daysPaid di level lowongan salah untuk kuota > 1), dan dari
    // kehadiran "pulang" yang sah untuk hari ini — tidak bisa dipicu sendiri tanpa
    // pulang yang sah kecuali disetujui employer secara eksplisit (lihat di bawah).
    const myPayouts = await tx
      .select({ dayIndex: dailyPayoutsTable.dayIndex })
      .from(dailyPayoutsTable)
      .where(and(eq(dailyPayoutsTable.jobId, gig.id), eq(dailyPayoutsTable.workerId, user.id)));
    const already = myPayouts.length;
    if (already >= totalDays) {
      return { status: 409 as const, error: "Semua pembayaran harian untukmu sudah dicairkan." };
    }
    // Pagar anggaran lintas jalur: total upah yang sudah dikreditkan untuk
    // lowongan ini (semua pekerja, semua jalur) tidak boleh melampaui dana yang
    // sudah didanai (audit K1).
    const alreadyCreditedJob = await creditedWagesForJob(tx, gig.id);

    // Atomic per-day dedup: insert the "pulang" attendance record now.
    // onConflictDoNothing silently skips on a unique-constraint violation so
    // the transaction doesn't abort; an empty returning() means today's
    // checkout was already claimed → return 409 before any funds move.
    const pulangRows = await tx
      .insert(attendanceTable)
      .values({
        jobId: gig.id,
        workerId: user.id,
        workerName: user.name,
        kind: "pulang",
        scanDate: today,
      })
      .onConflictDoNothing()
      .returning({ id: attendanceTable.id });

    if (pulangRows.length === 0) {
      return {
        status: 409 as const,
        error: "Kamu sudah checkout hari ini. Hanya satu checkout per hari yang diperbolehkan.",
      };
    }

    const dayIndex = already + 1;
    const { grossFraction, platformFee, netToWorker } = dailyFractionFor(
      workerWageTotal,
      totalDays,
      dayIndex,
    );
    if (alreadyCreditedJob + netToWorker > totalWorkerPayout) {
      return { status: 409 as const, error: "Dana proyek tidak mencukupi untuk pembayaran hari ini." };
    }
    const fundedPerWorker = Math.floor(totalDeposit / workerCount);
    const residualForEmployer = dayIndex >= totalDays
      ? Math.max(0, fundedPerWorker - workerWageTotal)
      : 0;

    const [payout] = await tx
      .insert(dailyPayoutsTable)
      .values({
        jobId: gig.id,
        workerId: user.id,
        status: "credited_to_wallet",
        workerName: user.name,
        dayIndex,
        grossFraction,
        platformFee,
        netToWorker,
      })
      .returning();

    await tx
      .insert(walletEntriesTable)
      .values({
        workerId: user.id,
        sourceType: "onsite_daily",
        sourceId: String(payout.id),
        amount: netToWorker,
        description: `Upah harian ke-${dayIndex}: ${gig.posisi}`,
      })
      .onConflictDoNothing();

    // "released" hanya ditetapkan saat SEMUA pekerja yang diterima sudah
    // menuntaskan kontraknya (audit T1: versi lama menandai released begitu
    // satu pekerja selesai, padahal pekerja lain pada kuota > 1 belum dibayar).
    const acceptedWorkers = await tx
      .select({ workerId: applicationsTable.workerId })
      .from(applicationsTable)
      .where(and(
        eq(applicationsTable.jobId, gig.id),
        inArray(applicationsTable.status, ["diterima", "selesai"]),
      ));
    const otherWorkerIds = acceptedWorkers
      .map((w) => w.workerId)
      .filter((id): id is string => !!id && id !== user.id);
    const othersDayCounts = otherWorkerIds.length
      ? await tx
          .select({ workerId: dailyPayoutsTable.workerId, n: sql<number>`count(*)::int` })
          .from(dailyPayoutsTable)
          .where(and(eq(dailyPayoutsTable.jobId, gig.id), inArray(dailyPayoutsTable.workerId, otherWorkerIds)))
          .groupBy(dailyPayoutsTable.workerId)
      : [];
    const othersDoneMap = new Map(othersDayCounts.map((r) => [r.workerId, r.n]));
    const othersComplete = otherWorkerIds.every((id) => (othersDoneMap.get(id) ?? 0) >= totalDays);
    const fullyPaid = dayIndex >= totalDays && othersComplete;
    const [updated] = await tx
      .update(gigsTable)
      .set({
        daysPaid: dayIndex, // dipertahankan untuk kompatibilitas tampilan lama; bukan lagi sumber kebenaran
        boronganType: "onsite",
        escrowStatus: fullyPaid ? "released" : gig.escrowStatus ?? "locked",
      })
      .where(eq(gigsTable.id, gig.id))
      .returning();

    return { status: 201 as const, gig: updated, payout, dayIndex, netToWorker, residualForEmployer };
  });

  if (outcome.status !== 201) {
    res.status(outcome.status).json({ error: outcome.error });
    return;
  }

  broadcastGig(outcome.gig);
  broadcastDailyPayout(outcome.payout);
  req.log.info(
    {
      jobId: outcome.gig.id,
      dayIndex: outcome.dayIndex,
      netToWorker: outcome.netToWorker,
      residualForEmployer: outcome.residualForEmployer,
    },
    "On-site borongan daily fraction released",
  );
  res.status(201).json({
    gig: outcome.gig,
    payout: outcome.payout,
    residualForEmployer: outcome.residualForEmployer,
  });
});

export default router;
