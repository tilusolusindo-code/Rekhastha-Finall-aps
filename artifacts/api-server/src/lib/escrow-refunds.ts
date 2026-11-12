import { sql } from "drizzle-orm";
import { adminLogsTable, db, escrowRefundsTable, gigsTable, notificationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { creditedWagesForJob, type DbTx } from "./wage-ledger";
import { notifyByEmail } from "./notify";
import { broadcastGig } from "./realtime";
import { logger } from "./logger";

/** Lowongan bertanggal: dianggap hangus sekian hari setelah tanggal kerja. */
export const REFUND_GRACE_DAYS_AFTER_JOB_DATE = 3;
/** Lowongan tanpa tanggal kerja: hangus sekian hari setelah diposting. */
export const REFUND_GRACE_DAYS_AFTER_POSTED = 14;

/**
 * Catat kewajiban refund untuk satu lowongan. Idempoten (satu baris per lowongan).
 * Nominal yang dikembalikan = dana upah yang ditahan (escrow); biaya layanan tidak ikut.
 * Harus dipanggil di dalam transaksi yang sudah mengunci baris gig.
 */
export async function recordRefund(
  tx: DbTx,
  gig: { id: number; employerId: string | null; escrowAmount: number | null },
  source: "auto_unused" | "admin",
  reason: string,
): Promise<void> {
  if (!gig.employerId || !gig.escrowAmount || gig.escrowAmount <= 0) return;
  await tx
    .insert(escrowRefundsTable)
    .values({ gigId: gig.id, employerId: gig.employerId, amount: gig.escrowAmount, source, reason })
    .onConflictDoNothing();
}

/**
 * Kembalikan escrow lowongan yang sudah didanai tetapi tidak pernah dipakai:
 * tidak ada pelamar berstatus diterima/selesai, tidak ada upah yang dikreditkan,
 * dan tanggal kerjanya (atau tanggal posting) sudah lewat masa tenggang.
 * Mengembalikan jumlah lowongan yang diproses.
 */
export async function refundUnusedEscrows(): Promise<{ refunded: number; amount: number }> {
  const candidates = await db.execute<{ id: number }>(sql`
    SELECT g.id FROM gigs g
    WHERE g.payment_status = 'confirmed'
      AND g.escrow_status = 'locked'
      AND g.employer_id IS NOT NULL
      AND COALESCE(g.escrow_amount, 0) > 0
      AND COALESCE(
            g.job_date + make_interval(days => ${REFUND_GRACE_DAYS_AFTER_JOB_DATE}),
            g.posted_at + make_interval(days => ${REFUND_GRACE_DAYS_AFTER_POSTED})
          ) < now()
      AND NOT EXISTS (
        SELECT 1 FROM applications a WHERE a.job_id = g.id AND a.status IN ('diterima', 'selesai')
      )
    ORDER BY g.id
    LIMIT 200
  `);

  let refunded = 0;
  let amount = 0;
  for (const { id } of candidates.rows) {
    try {
      const result = await db.transaction(async (tx) => {
        const [gig] = await tx.select().from(gigsTable).where(eq(gigsTable.id, Number(id))).for("update").limit(1);
        // Cek ulang setelah dikunci: bisa saja berubah sejak daftar kandidat diambil.
        if (!gig || gig.paymentStatus !== "confirmed" || gig.escrowStatus !== "locked") return null;
        if ((await creditedWagesForJob(tx, gig.id)) > 0) return null;
        const accepted = await tx.execute(sql`
          SELECT 1 FROM applications WHERE job_id = ${gig.id} AND status IN ('diterima', 'selesai') LIMIT 1
        `);
        if (accepted.rows.length > 0) return null;

        const reason = "Lowongan berakhir tanpa pekerja yang diterima; dana upah dikembalikan.";
        const [updated] = await tx
          .update(gigsTable)
          .set({ escrowStatus: "refunded", broadcastActive: false })
          .where(eq(gigsTable.id, gig.id))
          .returning();
        await recordRefund(tx, gig, "auto_unused", reason);
        await tx.insert(adminLogsTable).values({ adminId: "system", action: "AUTO_REFUND", targetId: String(gig.id), reason });
        return { gig: updated!, amount: gig.escrowAmount ?? 0 };
      });
      if (!result) continue;
      refunded += 1;
      amount += result.amount;
      broadcastGig(result.gig);
      const employerId = String(result.gig.employerId);
      const rp = `Rp ${result.amount.toLocaleString("id-ID")}`;
      await db.insert(notificationsTable).values({
        userId: employerId,
        message: `Lowongan "${result.gig.posisi}" berakhir tanpa pekerja. Dana upah ${rp} akan dikembalikan ke Anda.`,
        type: "refund",
      }).catch(() => {});
      void notifyByEmail(employerId, {
        kind: "payment",
        title: `Pengembalian dana lowongan — ${result.gig.posisi}`,
        detail: `Lowongan "${result.gig.posisi}" berakhir tanpa pekerja yang diterima. Dana upah sebesar ${rp} akan dikembalikan ke Anda. Admin akan memproses transfer pengembalian.`,
      });
    } catch (err) {
      logger.error({ err, gigId: id }, "[escrow-refunds] gagal memproses refund otomatis");
    }
  }
  if (refunded > 0) logger.info({ refunded, amount }, "[escrow-refunds] refund otomatis selesai");
  return { refunded, amount };
}
