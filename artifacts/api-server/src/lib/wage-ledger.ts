/**
 * Pagar anggaran upah per lowongan (audit K1/T1/T2).
 *
 * Upah worker dikreditkan lewat TIGA jalur (gig_wage, remote_borongan,
 * onsite_daily). Total kredit dari ketiganya untuk satu lowongan tidak boleh
 * melebihi `gigs.total_worker_payout` (nilai yang sudah didanai escrow).
 * Fungsi ini harus dipanggil di dalam transaksi yang sudah mengunci baris gig.
 */
import { sql } from "drizzle-orm";
import type { db } from "@workspace/db";

export type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Status escrow yang tidak boleh lagi dibayarkan ke pekerja. */
export const ESCROW_NO_PAYOUT_STATUSES = [
  "pending_payment",
  "refunded",
  "disputed",
  "disputed_active",
] as const;

export function escrowAllowsPayout(escrowStatus: string | null | undefined): boolean {
  return !(ESCROW_NO_PAYOUT_STATUSES as readonly string[]).includes(escrowStatus ?? "");
}

/** Total rupiah yang SUDAH dikreditkan ke wallet pekerja untuk satu lowongan. */
export async function creditedWagesForJob(tx: DbTx, jobId: number): Promise<number> {
  const result = await tx.execute(sql`
    SELECT COALESCE(SUM(amount), 0)::bigint AS total FROM (
      SELECT we.amount
        FROM wallet_entries we
        JOIN applications a ON we.source_type = 'gig_wage' AND we.source_id = a.id::text
       WHERE a.job_id = ${jobId}
      UNION ALL
      SELECT we.amount
        FROM wallet_entries we
       WHERE we.source_type = 'remote_borongan' AND we.source_id = ${String(jobId)}
      UNION ALL
      SELECT we.amount
        FROM wallet_entries we
        JOIN daily_payouts dp ON we.source_type = 'onsite_daily' AND we.source_id = dp.id::text
       WHERE dp.job_id = ${jobId}
    ) credited
  `);
  const row = result.rows[0] as { total?: string | number } | undefined;
  return Number(row?.total ?? 0);
}
