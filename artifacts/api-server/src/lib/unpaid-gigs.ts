import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";

/** Lowongan yang belum dibayar ditutup otomatis setelah selama ini. */
export const UNPAID_GIG_TTL_HOURS = 24;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Tutup lowongan belum dibayar (payment_status = awaiting_payment) milik satu pemberi kerja.
 * Tagihan manual yang masih menunggu dan pesanan instan yang tertunda ikut dibatalkan.
 * Mengembalikan id lowongan yang ditutup.
 *
 * Catatan: jika tautan Snap lama masih terbuka lalu dibayar, webhook Midtrans tetap
 * mengaktifkan lowongan itu (uang tidak hilang); lihat routes/midtrans.ts.
 */
async function cancelGigs(tx: Tx, gigIds: number[]): Promise<void> {
  if (gigIds.length === 0) return;
  const ids = sql.join(gigIds.map((id) => sql`${id}`), sql`, `);
  await tx.execute(sql`
    UPDATE manual_payments SET status = 'cancelled', admin_note = 'Lowongan dibatalkan sebelum dibayar.'
    WHERE target_type = 'gig_escrow' AND status = 'awaiting_payment'
      AND target_id IN (SELECT id::text FROM gigs WHERE id IN (${ids}))
  `);
  await tx.execute(sql`
    UPDATE instant_orders SET status = 'cancelled'
    WHERE status = 'pending' AND job_id IN (${ids})
  `);
}

/** Batalkan satu lowongan belum dibayar oleh pemiliknya. */
export async function cancelUnpaidGig(
  gigId: number,
  employerId: string,
): Promise<"cancelled" | "not_found" | "not_unpaid"> {
  return db.transaction(async (tx) => {
    const found = await tx.execute<{ employer_id: string | null; payment_status: string }>(sql`
      SELECT employer_id, payment_status FROM gigs WHERE id = ${gigId} FOR UPDATE
    `);
    const gig = found.rows[0];
    if (!gig || gig.employer_id !== employerId) return "not_found" as const;
    if (gig.payment_status !== "awaiting_payment") return "not_unpaid" as const;
    await tx.execute(sql`
      UPDATE gigs SET payment_status = 'cancelled', escrow_status = 'cancelled', broadcast_active = false
      WHERE id = ${gigId}
    `);
    await cancelGigs(tx, [gigId]);
    return "cancelled" as const;
  });
}

/**
 * Tutup otomatis lowongan milik pemberi kerja yang belum dibayar lebih dari 24 jam.
 * Dilewati bila masih ada tautan pembayaran Midtrans yang dibuat dalam 24 jam terakhir
 * atau bukti transfer manual yang sedang ditinjau admin.
 */
export async function expireStaleUnpaidGigs(employerId: string): Promise<number> {
  try {
    return await db.transaction(async (tx) => {
      const stale = await tx.execute<{ id: number }>(sql`
        SELECT g.id FROM gigs g
        WHERE g.employer_id = ${employerId}
          AND g.payment_status = 'awaiting_payment'
          AND g.posted_at < now() - make_interval(hours => ${UNPAID_GIG_TTL_HOURS})
          AND NOT EXISTS (
            SELECT 1 FROM midtrans_payments m
            WHERE m.job_id = g.id::text
              AND m.created_at > now() - make_interval(hours => ${UNPAID_GIG_TTL_HOURS})
          )
          AND NOT EXISTS (
            SELECT 1 FROM manual_payments p
            WHERE p.target_type = 'gig_escrow' AND p.target_id = g.id::text
              AND p.status NOT IN ('awaiting_payment', 'cancelled', 'rejected')
          )
        FOR UPDATE OF g
      `);
      const ids = stale.rows.map((r) => Number(r.id));
      if (ids.length === 0) return 0;
      const list = sql.join(ids.map((id) => sql`${id}`), sql`, `);
      await tx.execute(sql`
        UPDATE gigs SET payment_status = 'cancelled', escrow_status = 'cancelled', broadcast_active = false
        WHERE id IN (${list}) AND payment_status = 'awaiting_payment'
      `);
      await cancelGigs(tx, ids);
      return ids.length;
    });
  } catch (err) {
    logger.error({ err, employerId }, "[unpaid-gigs] gagal menutup lowongan kedaluwarsa");
    return 0;
  }
}
