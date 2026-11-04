import { Router, type IRouter } from "express";
import { desc, eq, or } from "drizzle-orm";
import { z } from "zod/v4";
import {
  companySubscriptionsTable,
  db,
  gigsTable,
  insertGigSchema,
  manualPaymentSettingsTable,
  manualPaymentsTable,
  usersTable,
} from "@workspace/db";
import { broadcastGig } from "../lib/realtime";
import { getSessionUser, SESSION_COOKIE } from "../lib/auth";
import {
  calculateTotalWorkerPayout,
  getAdminFeeAmount,
  getAdminFeeListAmount,
  hasAdminFeeWaiverAt,
} from "../lib/pricing";

const router: IRouter = Router();

const createGigBody = insertGigSchema.extend({
  postedAt: z.coerce.date().optional(),
  jobDate: z.coerce.date().nullish(),
  jobCategory: z.string().nullish(),
  feeRate: z.number().nullish(),
  applicationQuestions: z.array(z.object({
    id: z.string().min(1).max(80),
    prompt: z.string().trim().min(2).max(240),
    required: z.boolean(),
    answerType: z.enum(["short", "long", "yes_no"]),
  })).max(10).optional(),
  requestedApplicationDocuments: z.array(z.enum(["cv", "portfolio", "file", "photo"]))
    .max(4)
    .optional(),
});

router.get("/gigs/fee-quote", async (req, res): Promise<void> => {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user || user.role !== "perusahaan") {
    res.status(403).json({ error: "Hanya akun perusahaan yang dapat meminta estimasi biaya." });
    return;
  }
  const category = typeof req.query["category"] === "string" ? req.query["category"] : "umum";
  const [employer] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, user.id))
    .limit(1);
  const [subscription] = await db
    .select()
    .from(companySubscriptionsTable)
    .where(eq(companySubscriptionsTable.companyId, user.id))
    .limit(1);
  const now = new Date();
  const waived = hasAdminFeeWaiverAt(now, employer, subscription);
  res.json({
    adminFeeAmount: waived ? 0 : getAdminFeeAmount(category),
    listPriceAmount: getAdminFeeListAmount(category),
    waived,
  });
});

/**
 * Kolom publik yang aman dikirim ke pekerja.
 * Kolom keuangan internal (escrowAmount, adminFeeAmount, totalWorkerPayout, feeRate,
 * proofUrl, flaggedSuspect, employerId) hanya tersedia di endpoint employer/admin.
 */
const PUBLIC_GIG_COLUMNS = {
  id: gigsTable.id,
  posisi: gigsTable.posisi,
  deskripsi: gigsTable.deskripsi,
  pembayaran: gigsTable.pembayaran,
  nominal: gigsTable.nominal,
  dresscode: gigsTable.dresscode,
  kuota: gigsTable.kuota,
  lat: gigsTable.lat,
  lng: gigsTable.lng,
  durasiKontrak: gigsTable.durasiKontrak,
  namaPerusahaan: gigsTable.namaPerusahaan,
  nibPerusahaan: gigsTable.nibPerusahaan,
  tipeAkun: gigsTable.tipeAkun,
  isAgency: gigsTable.isAgency,
  hiringMode: gigsTable.hiringMode,
  broadcastActive: gigsTable.broadcastActive,
  jobDate: gigsTable.jobDate,
  jamKerja: gigsTable.jamKerja,
  alamat: gigsTable.alamat,
  escrowStatus: gigsTable.escrowStatus,
  paymentStatus: gigsTable.paymentStatus,
  jumlahHari: gigsTable.jumlahHari,
  employerName: gigsTable.employerName,
  jobCategory: gigsTable.jobCategory,
  applicationQuestions: gigsTable.applicationQuestions,
  requestedApplicationDocuments: gigsTable.requestedApplicationDocuments,
  boronganType: gigsTable.boronganType,
  proofStatus: gigsTable.proofStatus,
  daysPaid: gigsTable.daysPaid,
  postedAt: gigsTable.postedAt,
} as const;

router.get("/gigs", async (req, res): Promise<void> => {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  const rows = await db
    .select(PUBLIC_GIG_COLUMNS)
    .from(gigsTable)
    .where(
      user?.role === "perusahaan"
        ? or(eq(gigsTable.paymentStatus, "confirmed"), eq(gigsTable.employerId, user.id))
        : eq(gigsTable.paymentStatus, "confirmed"),
    )
    .orderBy(desc(gigsTable.postedAt));
  res.json(rows);
});

router.post("/gigs", async (req, res): Promise<void> => {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  const parsed = createGigBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid gig body");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  if (!user || user.role !== "perusahaan") {
    res.status(403).json({ error: "Hanya akun perusahaan yang dapat membuat lowongan." });
    return;
  }

  const [existing] = await db
    .select()
    .from(gigsTable)
    .where(eq(gigsTable.id, parsed.data.id))
    .limit(1);
  if (existing) {
    if (existing.employerId !== user.id) {
      res.status(403).json({ error: "Lowongan ini bukan milik akun Anda." });
      return;
    }
    const wageTermsChanged =
      parsed.data.nominal !== existing.nominal ||
      parsed.data.pembayaran !== existing.pembayaran ||
      (parsed.data.jumlahHari ?? null) !== (existing.jumlahHari ?? null) ||
      (parsed.data.kuota ?? 1) !== (existing.kuota ?? 1);
    const payoutIsSaved = existing.totalWorkerPayout != null ||
      existing.paymentStatus === "confirmed" ||
      existing.escrowStatus === "locked";
    if (wageTermsChanged && payoutIsSaved) {
      res.status(409).json({
        error: "Upah tidak dapat diubah setelah payout disimpan atau dana dikonfirmasi.",
      });
      return;
    }
    const [updated] = await db
      .update(gigsTable)
      .set({
        ...parsed.data,
        employerId: existing.employerId,
        paymentStatus: existing.paymentStatus,
        postedAt: existing.postedAt,
        escrowStatus: existing.escrowStatus,
        escrowAmount: existing.escrowAmount,
        broadcastActive: existing.broadcastActive,
        jobCategory: parsed.data.jobCategory ?? existing.jobCategory,
        feeRate: existing.feeRate,
        adminFeeAmount: existing.adminFeeAmount,
        totalWorkerPayout: existing.totalWorkerPayout,
      })
      .where(eq(gigsTable.id, existing.id))
      .returning();
    if (updated.paymentStatus === "confirmed") broadcastGig(updated);
    res.json(updated);
    return;
  }

  const kuota = parsed.data.kuota ?? 1;
  const amount = calculateTotalWorkerPayout(
    parsed.data.nominal,
    parsed.data.pembayaran,
    parsed.data.jumlahHari ?? null,
    kuota,
  );
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    res.status(400).json({ error: "Nilai upah tidak valid." });
    return;
  }
  const { feeAmount, postedAt } = await db.transaction(async (tx) => {
    const [employer] = await tx
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, user.id))
      .limit(1);
    const [monthlySubscription] = await tx
      .select()
      .from(companySubscriptionsTable)
      .where(eq(companySubscriptionsTable.companyId, user.id))
      .limit(1);
    const now = new Date();
    const waived = hasAdminFeeWaiverAt(now, employer, monthlySubscription);
    return {
      feeAmount: waived ? 0 : getAdminFeeAmount(parsed.data.jobCategory),
      postedAt: now,
    };
  });
  const [settings] = await db
    .select({ accountNumber: manualPaymentSettingsTable.accountNumber })
    .from(manualPaymentSettingsTable)
    .where(eq(manualPaymentSettingsTable.id, 1))
    .limit(1);
  if (!settings?.accountNumber) {
    res.status(409).json({ error: "Instruksi transfer belum diatur oleh admin. Lowongan belum dibuat." });
    return;
  }

  const result = await db.transaction(async (tx) => {
    const [gig] = await tx
      .insert(gigsTable)
      .values({
        ...parsed.data,
        postedAt,
        kuota,
        employerId: user.id,
        employerName: user.name,
        escrowAmount: amount,
        escrowStatus: "pending_payment",
        adminFeeAmount: feeAmount,
        totalWorkerPayout: amount,
        feeRate: 0,
        paymentStatus: "awaiting_payment",
        broadcastActive: false,
      })
      .onConflictDoNothing()
      .returning();
    if (!gig) return { error: "id_conflict" as const };
    const [payment] = await tx
      .insert(manualPaymentsTable)
      .values({
        payerId: user.id,
        targetType: "gig_escrow",
        targetId: String(gig.id),
        amount: amount + feeAmount,
      })
      .returning();
    return { gig, payment };
  });

  if ("error" in result) {
    res.status(409).json({ error: "ID lowongan sudah digunakan. Coba buat ulang lowongan." });
    return;
  }
  req.log.info(
    { gigId: result.gig.id, employerId: user.id, amount },
    "Gig created and held for manual payment review",
  );
  res.status(201).json({ ...result.gig, manualPaymentId: result.payment.id });
});

export default router;
