import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { z } from "zod/v4";
import {
  applicationsTable,
  companySubscriptionsTable,
  db,
  gigsTable,
  insertGigSchema,
  manualPaymentSettingsTable,
  manualPaymentsTable,
  usersTable,
} from "@workspace/db";
import { broadcastGig } from "../lib/realtime";
import { cancelUnpaidGig, expireStaleUnpaidGigs } from "../lib/unpaid-gigs";
import { getSessionUser, SESSION_COOKIE } from "../lib/auth";
import {
  calculateTotalWorkerPayout,
  getAdminFeeAmount,
  getAdminFeeListAmount,
  hasAdminFeeWaiverAt,
} from "../lib/pricing";

const router: IRouter = Router();

/**
 * Allowlist eksplisit (audit K2). `insertGigSchema` (drizzle-zod) menerima
 * SEMUA kolom tabel gigs, termasuk status, dana, dan field yang dikontrol
 * admin/server (flaggedSuspect, daysPaid, proofStatus, dll). Field itu TIDAK
 * ada di sini, jadi walau klien mengirimnya, nilainya tidak pernah dibaca —
 * lihat juga pickClientFields() di bawah yang membuang sisanya sebelum query.
 *
 * Identitas perusahaan (namaPerusahaan/nibPerusahaan/tipeAkun/isAgency)
 * SENGAJA tidak diterima dari body: diturunkan dari profil akun di server
 * (lihat companyIdentityFor()) supaya lowongan tidak bisa mengaku sebagai
 * perusahaan lain.
 */
const createGigBody = z.object({
  id: insertGigSchema.shape.id,
  posisi: insertGigSchema.shape.posisi,
  deskripsi: insertGigSchema.shape.deskripsi,
  pembayaran: insertGigSchema.shape.pembayaran,
  nominal: insertGigSchema.shape.nominal,
  dresscode: insertGigSchema.shape.dresscode,
  kuota: insertGigSchema.shape.kuota,
  lat: insertGigSchema.shape.lat,
  lng: insertGigSchema.shape.lng,
  durasiKontrak: insertGigSchema.shape.durasiKontrak,
  hiringMode: insertGigSchema.shape.hiringMode,
  jamKerja: insertGigSchema.shape.jamKerja,
  alamat: insertGigSchema.shape.alamat,
  jumlahHari: insertGigSchema.shape.jumlahHari,
  jobDate: z.coerce.date().nullish(),
  jobCategory: z.string().nullish(),
  applicationQuestions: z.array(z.object({
    id: z.string().min(1).max(80),
    prompt: z.string().trim().min(2).max(240),
    required: z.boolean(),
    answerType: z.enum(["short", "long", "yes_no", "photo", "file"]),
  })).max(10).superRefine((qs, ctx) => {
    // Syarat unggahan dibatasi agar total berkas per lamaran tetap wajar (maks 8 berkas).
    if (qs.filter((q) => q.answerType === "photo" || q.answerType === "file").length > 4) {
      ctx.addIssue({ code: "custom", message: "Maksimal 4 syarat foto/file per lowongan." });
    }
    if (new Set(qs.map((q) => q.id)).size !== qs.length) {
      ctx.addIssue({ code: "custom", message: "ID pertanyaan tidak boleh duplikat." });
    }
  }).optional(),
  requestedApplicationDocuments: z.array(z.enum(["cv", "portfolio", "file", "photo"]))
    .max(4)
    .optional(),
});

/** Field deskriptif yang masih boleh diedit setelah ada pelamar diterima (audit S11 TIDAK berlaku ke sini — ini daftar yang justru DIKUNCI). */
const FINANCIAL_LOCK_FIELDS = ["posisi", "deskripsi", "dresscode", "alamat", "jamKerja"] as const;

async function companyIdentityFor(userId: string): Promise<{
  namaPerusahaan: string | null;
  nibPerusahaan: string | null;
  tipeAkun: string | null;
  isAgency: boolean;
}> {
  const [row] = await db.select({ profile: usersTable.profile }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  const profile = (row?.profile ?? {}) as Record<string, unknown>;
  const str = (k: string) => typeof profile[k] === "string" && profile[k] ? (profile[k] as string) : null;
  return {
    namaPerusahaan: str("namaPerusahaan"),
    nibPerusahaan: str("nibPerusahaan"),
    tipeAkun: str("tipeAkun"),
    isAgency: profile["tipeAkun"] === "agensi",
  };
}

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

router.get("/gigs", async (req, res): Promise<void> => {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  // Tutup lowongan milik pemberi kerja ini yang belum dibayar lebih dari 24 jam.
  if (user?.role === "perusahaan") await expireStaleUnpaidGigs(user.id);
  const rows = await db
    .select({ gig: gigsTable, employerAvatarUrl: usersTable.avatarUrl })
    .from(gigsTable)
    .leftJoin(usersTable, eq(gigsTable.employerId, usersTable.id))
    .where(
      user?.role === "perusahaan"
        ? or(
            eq(gigsTable.paymentStatus, "confirmed"),
            and(eq(gigsTable.employerId, user.id), ne(gigsTable.paymentStatus, "cancelled")),
          )
        : eq(gigsTable.paymentStatus, "confirmed"),
    )
    .orderBy(desc(gigsTable.postedAt));
  res.json(
    rows.map(({ gig, employerAvatarUrl }) => {
      const out: Record<string, unknown> = { ...gig, employerAvatarUrl: employerAvatarUrl ?? null };
      if (!user) {
        // Pengunjung tanpa login hanya perlu data etalase; rincian dana & bukti kerja disembunyikan.
        for (const k of ["escrowAmount", "adminFeeAmount", "proofUrl", "proofStatus", "proofSubmittedBy"]) delete out[k];
      }
      return out;
    }),
  );
});

/** Batalkan lowongan yang belum dibayar (hanya pemiliknya). */
router.post("/gigs/:id/cancel-unpaid", async (req, res): Promise<void> => {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user || user.role !== "perusahaan") {
    res.status(401).json({ error: "Tidak terautentikasi." });
    return;
  }
  const gigId = Number(req.params["id"]);
  if (!Number.isSafeInteger(gigId) || gigId < 1) {
    res.status(400).json({ error: "ID lowongan tidak valid." });
    return;
  }
  const result = await cancelUnpaidGig(gigId, user.id);
  if (result === "not_found") {
    res.status(404).json({ error: "Lowongan tidak ditemukan." });
    return;
  }
  if (result === "not_unpaid") {
    res.status(409).json({ error: "Hanya lowongan yang belum dibayar yang bisa dibatalkan." });
    return;
  }
  req.log.info({ gigId, employerId: user.id }, "Unpaid gig cancelled by employer");
  res.json({ ok: true, id: gigId });
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
    // Audit S11: setelah ada pelamar diterima, lokasi/tanggal/jam kerja TIDAK
    // boleh lagi diubah (bait-and-switch terhadap pekerja yang sudah setuju).
    const [{ n: acceptedCount } = { n: 0 }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(applicationsTable)
      .where(and(
        eq(applicationsTable.jobId, existing.id),
        inArray(applicationsTable.status, ["diterima", "selesai"]),
      ));
    const locationOrScheduleChanged =
      parsed.data.lat !== existing.lat ||
      parsed.data.lng !== existing.lng ||
      parsed.data.alamat !== existing.alamat ||
      parsed.data.jamKerja !== existing.jamKerja ||
      (parsed.data.jobDate?.getTime() ?? null) !== (existing.jobDate?.getTime() ?? null);
    if (acceptedCount > 0 && locationOrScheduleChanged) {
      res.status(409).json({
        error: "Lokasi, tanggal, atau jam kerja tidak dapat diubah setelah ada pekerja diterima.",
      });
      return;
    }

    // Allowlist eksplisit (audit K2): hanya field deskriptif yang bisa ditulis
    // klien. Status, dana, dan identitas perusahaan SELALU dari server.
    const identity = await companyIdentityFor(user.id);
    const [updated] = await db
      .update(gigsTable)
      .set({
        posisi: parsed.data.posisi,
        deskripsi: parsed.data.deskripsi,
        dresscode: parsed.data.dresscode,
        alamat: parsed.data.alamat,
        jamKerja: parsed.data.jamKerja,
        durasiKontrak: parsed.data.durasiKontrak,
        jobDate: parsed.data.jobDate ?? null,
        jobCategory: parsed.data.jobCategory ?? existing.jobCategory,
        applicationQuestions: parsed.data.applicationQuestions ?? existing.applicationQuestions,
        requestedApplicationDocuments: parsed.data.requestedApplicationDocuments ?? existing.requestedApplicationDocuments,
        lat: acceptedCount > 0 ? existing.lat : parsed.data.lat,
        lng: acceptedCount > 0 ? existing.lng : parsed.data.lng,
        namaPerusahaan: identity.namaPerusahaan,
        nibPerusahaan: identity.nibPerusahaan,
        tipeAkun: identity.tipeAkun,
        isAgency: identity.isAgency,
        employerName: user.name,
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

  const identity = await companyIdentityFor(user.id);
  const result = await db.transaction(async (tx) => {
    const [gig] = await tx
      .insert(gigsTable)
      .values({
        id: parsed.data.id,
        posisi: parsed.data.posisi,
        deskripsi: parsed.data.deskripsi,
        pembayaran: parsed.data.pembayaran,
        nominal: parsed.data.nominal,
        dresscode: parsed.data.dresscode,
        lat: parsed.data.lat,
        lng: parsed.data.lng,
        durasiKontrak: parsed.data.durasiKontrak,
        hiringMode: parsed.data.hiringMode,
        jamKerja: parsed.data.jamKerja,
        alamat: parsed.data.alamat,
        jumlahHari: parsed.data.jumlahHari,
        jobDate: parsed.data.jobDate ?? null,
        jobCategory: parsed.data.jobCategory ?? null,
        applicationQuestions: parsed.data.applicationQuestions ?? [],
        requestedApplicationDocuments: parsed.data.requestedApplicationDocuments ?? [],
        postedAt,
        kuota,
        employerId: user.id,
        employerName: user.name,
        namaPerusahaan: identity.namaPerusahaan,
        nibPerusahaan: identity.nibPerusahaan,
        tipeAkun: identity.tipeAkun,
        isAgency: identity.isAgency,
        escrowAmount: amount,
        escrowStatus: "pending_payment",
        adminFeeAmount: feeAmount,
        totalWorkerPayout: amount,
        feeRate: 0,
        paymentStatus: "awaiting_payment",
        broadcastActive: false,
        flaggedSuspect: false,
        daysPaid: 0,
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
