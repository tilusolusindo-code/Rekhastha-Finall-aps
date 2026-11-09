import { eq } from "drizzle-orm";
import {
  db,
  companySubscriptionsTable,
  escrowProjectsTable,
  gigsTable,
  instantOrdersTable,
  subscriptionOrdersTable,
  subscriptionPlansTable,
  usersTable,
  type ManualPayment,
} from "@workspace/db";

export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type PaymentBroadcast = {
  gig: typeof gigsTable.$inferSelect;
  instant: boolean;
} | null;

export type ApplyPaymentResult =
  | { error: "target_mismatch" | "unknown_target" }
  | { broadcast: PaymentBroadcast };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Applies the business effect of a confirmed payment (fund a gig's wage escrow,
 * activate a subscription, ...). Shared by the admin review endpoint and the
 * Midtrans settlement so both paths enforce exactly the same ownership and
 * amount checks — an online payment can never activate more than the transfer
 * an admin would have confirmed.
 *
 * MUST run inside a transaction in which the caller already holds
 * `SELECT ... FOR UPDATE` on the `manual_payments` row. It does NOT change the
 * manual payment's own status; the caller does that after a successful apply.
 */
export async function applyConfirmedPayment(
  tx: DbTransaction,
  payment: ManualPayment,
): Promise<ApplyPaymentResult> {
  switch (payment.targetType) {
    case "gig_escrow": {
      const gigId = Number(payment.targetId);
      const [gig] = await tx
        .select()
        .from(gigsTable)
        .where(eq(gigsTable.id, gigId))
        .for("update")
        .limit(1);
      if (
        !gig ||
        gig.employerId !== payment.payerId ||
        (gig.escrowAmount ?? 0) + (gig.adminFeeAmount ?? 0) !== payment.amount
      ) {
        return { error: "target_mismatch" };
      }
      const [fundedGig] = await tx
        .update(gigsTable)
        .set({
          paymentStatus: "confirmed",
          escrowStatus: "locked",
          broadcastActive: gig.hiringMode === "cepat",
        })
        .where(eq(gigsTable.id, gigId))
        .returning();
      const [instantOrder] = await tx
        .select()
        .from(instantOrdersTable)
        .where(eq(instantOrdersTable.jobId, gigId))
        .limit(1);
      if (gig.hiringMode === "cepat" && instantOrder?.status === "pending") {
        await tx
          .update(instantOrdersTable)
          .set({ status: "active" })
          .where(eq(instantOrdersTable.id, instantOrder.id));
      }
      return { broadcast: { gig: fundedGig, instant: gig.hiringMode === "cepat" } };
    }
    case "instant_listing": {
      const orderId = Number(payment.targetId);
      const [order] = await tx
        .select()
        .from(instantOrdersTable)
        .where(eq(instantOrdersTable.id, orderId))
        .for("update")
        .limit(1);
      if (!order || order.companyId !== payment.payerId || order.amount !== payment.amount) {
        return { error: "target_mismatch" };
      }
      await tx
        .update(instantOrdersTable)
        .set({ status: "active" })
        .where(eq(instantOrdersTable.id, orderId));
      const [gig] = await tx
        .select()
        .from(gigsTable)
        .where(eq(gigsTable.id, order.jobId))
        .limit(1);
      if (gig?.paymentStatus === "confirmed") {
        const [activeGig] = await tx
          .update(gigsTable)
          .set({ broadcastActive: true })
          .where(eq(gigsTable.id, gig.id))
          .returning();
        return { broadcast: { gig: activeGig, instant: true } };
      }
      return { broadcast: null };
    }
    case "legacy_subscription": {
      const [previous] = await tx
        .select()
        .from(companySubscriptionsTable)
        .where(eq(companySubscriptionsTable.companyId, payment.payerId))
        .limit(1);
      const now = Date.now();
      const base =
        previous?.expiresAt && previous.expiresAt.getTime() > now
          ? previous.expiresAt.getTime()
          : now;
      const expiresAt = new Date(base + 30 * DAY_MS);
      await tx
        .insert(companySubscriptionsTable)
        .values({ companyId: payment.payerId, isPremium: true, expiresAt })
        .onConflictDoUpdate({
          target: companySubscriptionsTable.companyId,
          set: { isPremium: true, expiresAt },
        });
      return { broadcast: null };
    }
    case "business_subscription": {
      const orderId = Number(payment.targetId);
      const [order] = await tx
        .select()
        .from(subscriptionOrdersTable)
        .where(eq(subscriptionOrdersTable.id, orderId))
        .for("update")
        .limit(1);
      if (
        !order ||
        order.companyId !== payment.payerId ||
        order.amount !== payment.amount ||
        order.status !== "pending"
      ) {
        return { error: "target_mismatch" };
      }
      const [plan] = await tx
        .select()
        .from(subscriptionPlansTable)
        .where(eq(subscriptionPlansTable.id, order.planId))
        .limit(1);
      const [company] = await tx
        .select({ expiredAt: usersTable.expiredAt })
        .from(usersTable)
        .where(eq(usersTable.id, order.companyId))
        .for("update") // two plans confirmed at once must both extend the expiry
        .limit(1);
      if (!plan || !company) return { error: "target_mismatch" };
      // Renewing before expiry accumulates onto the old expiry, never resets.
      const now = Date.now();
      const base =
        company.expiredAt && company.expiredAt.getTime() > now
          ? company.expiredAt.getTime()
          : now;
      const expiredAt = new Date(base + plan.durationDays * DAY_MS);
      await tx
        .update(subscriptionOrdersTable)
        .set({ status: "success", paidAt: new Date() })
        .where(eq(subscriptionOrdersTable.id, orderId));
      await tx
        .update(usersTable)
        .set({ isPremium: true, expiredAt })
        .where(eq(usersTable.id, order.companyId));
      return { broadcast: null };
    }
    case "project_escrow": {
      const projectId = Number(payment.targetId);
      const [project] = await tx
        .select()
        .from(escrowProjectsTable)
        .where(eq(escrowProjectsTable.id, projectId))
        .for("update")
        .limit(1);
      if (
        !project ||
        project.employerId !== payment.payerId ||
        project.totalAmount !== payment.amount
      ) {
        return { error: "target_mismatch" };
      }
      await tx
        .update(escrowProjectsTable)
        .set({ status: "funded", fundedAt: new Date() })
        .where(eq(escrowProjectsTable.id, projectId));
      return { broadcast: null };
    }
    default:
      return { error: "unknown_target" };
  }
}
