import { eq } from "drizzle-orm";
import {
  db,
  adminLogsTable,
  manualPaymentsTable,
  midtransPaymentsTable,
} from "@workspace/db";
import { logger } from "./logger";
import {
  getTransactionStatus,
  isPaidLike,
  mapTransactionStatus,
  nextPaymentStatus,
  parseDate,
  parseGrossAmount,
  type MidtransPaymentStatus,
  type MidtransTransactionStatus,
} from "./midtrans";
import {
  applyConfirmedPayment,
  type DbTransaction,
  type PaymentBroadcast,
} from "./manual-payment-confirm";

export const MIDTRANS_ACTOR_PREFIX = "midtrans:";

export type SettleResult =
  | { kind: "unknown_order" }
  | { kind: "not_found_at_midtrans" }
  | { kind: "ignored_status"; transactionStatus: string }
  | {
      kind: "processed";
      status: string;
      changed: boolean;
      broadcast: PaymentBroadcast;
    };

export type SettleDeps = {
  /** Injected so tests can run without the network. */
  fetchStatus?: (orderId: string) => Promise<MidtransTransactionStatus | null>;
};

/**
 * Brings our ledger in line with what Midtrans says about `orderId`, and, when
 * the customer really paid, activates the service the order was paying for.
 *
 * Idempotent and safe to call from many places at once (notification webhook,
 * status polling): rows are locked, transitions only move forward (see
 * nextPaymentStatus), and an obligation is confirmed at most once.
 *
 * The truth comes from Midtrans' Status API, never from the request that
 * triggered us, so a forged notification cannot activate anything.
 */
export async function settleMidtransOrder(
  orderId: string,
  deps: SettleDeps = {},
): Promise<SettleResult> {
  const fetchStatus = deps.fetchStatus ?? ((id: string) => getTransactionStatus(id));

  const [known] = await db
    .select({ id: midtransPaymentsTable.id })
    .from(midtransPaymentsTable)
    .where(eq(midtransPaymentsTable.orderId, orderId))
    .limit(1);
  if (!known) return { kind: "unknown_order" };

  const remote = await fetchStatus(orderId);
  if (!remote) return { kind: "not_found_at_midtrans" };

  const mapped = mapTransactionStatus(remote.transactionStatus, remote.fraudStatus);
  if (!mapped) {
    logger.warn(
      { orderId, transactionStatus: remote.transactionStatus },
      "[midtrans] unrecognised transaction_status, ignoring",
    );
    return { kind: "ignored_status", transactionStatus: remote.transactionStatus };
  }
  const remoteAmount = parseGrossAmount(remote.grossAmount);

  const outcome = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(midtransPaymentsTable)
      .where(eq(midtransPaymentsTable.orderId, orderId))
      .for("update")
      .limit(1);
    if (!row) return { status: "pending", changed: false, broadcast: null as PaymentBroadcast };

    let incoming: MidtransPaymentStatus = mapped;
    let broadcast: PaymentBroadcast = null;

    // The amount Midtrans collected must equal the amount we asked for.
    if (isPaidLike(incoming) && remoteAmount !== row.grossAmount) {
      logger.error(
        { orderId, expected: row.grossAmount, received: remote.grossAmount },
        "[midtrans] paid amount does not match the order — NOT activating",
      );
      incoming = "amount_mismatch";
    }

    if (incoming === "paid") {
      const target = await applyPaid(tx, row, remote, orderId);
      incoming = target.status;
      broadcast = target.broadcast;
    }

    const next = nextPaymentStatus(row.status, incoming);
    // A stale or duplicate notification that would not move the ledger changes
    // nothing: keep the record of the transaction that really paid.
    if (next === row.status) {
      return { status: row.status, changed: false, broadcast: null as PaymentBroadcast };
    }
    if (next === "refunded") {
      logger.warn(
        { orderId, manualPaymentId: row.manualPaymentId },
        "[midtrans] refund/chargeback received — the activated service is NOT revoked automatically; review it",
      );
    }

    await tx
      .update(midtransPaymentsTable)
      .set({
        status: next,
        transactionId: remote.transactionId,
        transactionStatus: remote.transactionStatus,
        paymentType: remote.paymentType,
        fraudStatus: remote.fraudStatus,
        transactionTime: parseDate(remote.transactionTime),
        settlementTime: parseDate(remote.settlementTime),
        rawNotification: remote.raw,
        updatedAt: new Date(),
      })
      .where(eq(midtransPaymentsTable.id, row.id));

    return { status: next, changed: true, broadcast };
  });

  return { kind: "processed", ...outcome };
}

type PaidOutcome = { status: MidtransPaymentStatus; broadcast: PaymentBroadcast };

/**
 * The customer paid. Confirm the manual obligation exactly once. Anything that
 * stops us from activating becomes a status an admin can see, never a silent
 * success.
 */
async function applyPaid(
  tx: DbTransaction,
  row: typeof midtransPaymentsTable.$inferSelect,
  remote: MidtransTransactionStatus,
  orderId: string,
): Promise<PaidOutcome> {
  if (row.manualPaymentId == null || row.userId == null) {
    // Legacy row from the old API: never bound to an obligation.
    logger.error({ orderId }, "[midtrans] paid order has no linked obligation — needs admin");
    return { status: "paid_unapplied", broadcast: null };
  }

  const [payment] = await tx
    .select()
    .from(manualPaymentsTable)
    .where(eq(manualPaymentsTable.id, row.manualPaymentId))
    .for("update")
    .limit(1);

  if (!payment || payment.payerId !== row.userId || payment.amount !== row.grossAmount) {
    logger.error(
      { orderId, manualPaymentId: row.manualPaymentId },
      "[midtrans] obligation missing or changed since the order was created — needs admin",
    );
    return { status: "paid_unapplied", broadcast: null };
  }

  if (payment.status === "confirmed") {
    if (payment.reviewedBy === `${MIDTRANS_ACTOR_PREFIX}${orderId}`) {
      return { status: "paid", broadcast: null }; // we already applied this order
    }
    logger.error(
      { orderId, manualPaymentId: payment.id },
      "[midtrans] obligation was already confirmed by another route — customer paid twice, refund needed",
    );
    return { status: "paid_duplicate", broadcast: null };
  }

  const applied = await applyConfirmedPayment(tx, payment);
  if ("error" in applied) {
    logger.error(
      { orderId, manualPaymentId: payment.id, reason: applied.error },
      "[midtrans] could not apply the payment to its target — needs admin",
    );
    return { status: "paid_unapplied", broadcast: null };
  }

  await tx
    .update(manualPaymentsTable)
    .set({
      status: "confirmed",
      transferReference: remote.transactionId ?? orderId,
      adminNote: `Dibayar otomatis via Midtrans (${remote.paymentType ?? "metode tidak diketahui"}), order ${orderId}.`,
      reviewedBy: `${MIDTRANS_ACTOR_PREFIX}${orderId}`,
      reviewedAt: new Date(),
      submittedAt: payment.submittedAt ?? new Date(),
    })
    .where(eq(manualPaymentsTable.id, payment.id));
  await tx.insert(adminLogsTable).values({
    adminId: "system:midtrans",
    action: "CONFIRM_MIDTRANS_PAYMENT",
    targetId: String(payment.id),
    reason: `Order ${orderId}`,
  });
  return { status: "paid", broadcast: applied.broadcast };
}
