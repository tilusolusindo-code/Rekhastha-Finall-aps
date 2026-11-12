import { and, eq, sql } from "drizzle-orm";
import { db, midtransPaymentsTable } from "@workspace/db";
import { cancelMidtransTransaction, isMidtransConfigured } from "./midtrans";
import { logger } from "./logger";

/** jobType di tabel midtrans_payments. */
export type LedgerKind = "posting" | "subscription";

/** Catat transaksi Snap yang baru dibuat. Gagal mencatat tidak boleh menggagalkan pembayaran. */
export async function recordSnapOrder(p: {
  orderId: string;
  kind: LedgerKind;
  refId: string | number;
  grossAmount: number;
  snapToken: string;
  redirectUrl: string;
}): Promise<void> {
  try {
    await db
      .insert(midtransPaymentsTable)
      .values({
        orderId: p.orderId,
        jobId: String(p.refId),
        jobType: p.kind,
        grossAmount: p.grossAmount,
        status: "pending",
        snapToken: p.snapToken,
        redirectUrl: p.redirectUrl,
      })
      .onConflictDoNothing();
  } catch (err) {
    logger.error({ err, orderId: p.orderId }, "[midtrans-ledger] gagal mencatat order");
  }
}

/** Perbarui catatan dari notifikasi / status Midtrans. */
export async function updateLedger(
  orderId: string,
  transactionStatus: string,
  extra: { paymentType?: string; fraudStatus?: string; transactionId?: string } = {},
): Promise<void> {
  const paid = transactionStatus === "settlement" || (transactionStatus === "capture" && extra.fraudStatus === "accept");
  const status = paid
    ? "paid"
    : transactionStatus === "expire"
      ? "expired"
      : transactionStatus === "cancel" || transactionStatus === "deny" || transactionStatus === "failure"
        ? "cancelled"
        : "pending";
  try {
    await db
      .update(midtransPaymentsTable)
      .set({
        status,
        transactionStatus,
        ...(extra.paymentType ? { paymentType: extra.paymentType } : {}),
        ...(extra.fraudStatus ? { fraudStatus: extra.fraudStatus } : {}),
        ...(extra.transactionId ? { transactionId: extra.transactionId } : {}),
        ...(paid ? { settlementTime: new Date() } : {}),
        updatedAt: new Date(),
      })
      .where(eq(midtransPaymentsTable.orderId, orderId));
  } catch (err) {
    logger.error({ err, orderId }, "[midtrans-ledger] gagal memperbarui catatan");
  }
}

/**
 * Batalkan semua transaksi Midtrans yang masih pending untuk satu tagihan
 * (lowongan atau order langganan). Best effort: kegagalan hanya dicatat.
 * Mengembalikan jumlah order yang ditandai batal.
 */
export async function cancelPendingFor(kind: LedgerKind, refId: string | number): Promise<number> {
  if (!isMidtransConfigured()) return 0;
  try {
    const rows = await db
      .select({ orderId: midtransPaymentsTable.orderId })
      .from(midtransPaymentsTable)
      .where(
        and(
          eq(midtransPaymentsTable.jobType, kind),
          eq(midtransPaymentsTable.jobId, String(refId)),
          eq(midtransPaymentsTable.status, "pending"),
        ),
      );
    let done = 0;
    for (const r of rows) {
      const result = await cancelMidtransTransaction(r.orderId);
      if (result === "failed") continue; // tetap pending; kedaluwarsa sendiri maksimal 24 jam
      await db
        .update(midtransPaymentsTable)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(and(eq(midtransPaymentsTable.orderId, r.orderId), eq(midtransPaymentsTable.status, "pending")));
      done += 1;
    }
    return done;
  } catch (err) {
    logger.error({ err, kind, refId }, "[midtrans-ledger] gagal membatalkan transaksi pending");
    return 0;
  }
}

/** Batalkan transaksi pending untuk semua order langganan belum lunas milik satu perusahaan. */
export async function cancelPendingSubscriptionsOf(companyId: string): Promise<void> {
  try {
    const orders = await db.execute<{ id: number }>(sql`
      SELECT id FROM subscription_orders WHERE company_id = ${companyId} AND status IS DISTINCT FROM 'paid'
    `);
    for (const o of orders.rows) await cancelPendingFor("subscription", o.id);
  } catch (err) {
    logger.error({ err, companyId }, "[midtrans-ledger] gagal membatalkan langganan pending");
  }
}
