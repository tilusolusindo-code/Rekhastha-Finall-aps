import { and, eq, inArray } from "drizzle-orm";
import {
  applicationsTable,
  adminLogsTable,
  db,
  gigsTable,
  walletEntriesTable,
} from "@workspace/db";
import { broadcastApplicationStatus, broadcastGig } from "./realtime";
import { calculateTotalWorkerPayout } from "./pricing";

type PayoutFailure =
  | "not_found"
  | "not_confirmed"
  | "invalid_status"
  | "workers_incomplete"
  | "amount_mismatch";

/**
 * Credit every accepted worker for a confirmed gig in one transaction.
 * wallet_entries' unique source key is the final duplicate-prevention guard,
 * shared with the normal worker-triggered wage release path.
 */
export async function forcePayoutGig(
  jobId: number,
  adminId: string,
  reason: string,
): Promise<
  | { ok: true; gig: typeof gigsTable.$inferSelect; amount: number; credited: number; duplicate: boolean; workers: typeof applicationsTable.$inferSelect[] }
  | { ok: false; error: PayoutFailure }
> {
  const result = await db.transaction(async (tx) => {
    const [gig] = await tx
      .select()
      .from(gigsTable)
      .where(eq(gigsTable.id, jobId))
      .limit(1)
      .for("update");
    if (!gig) return { ok: false as const, error: "not_found" as const };
    if (gig.paymentStatus !== "confirmed") {
      return { ok: false as const, error: "not_confirmed" as const };
    }
    if (!["pending", "processing", "locked"].includes(gig.escrowStatus ?? "")) {
      return { ok: false as const, error: "invalid_status" as const };
    }

    const workers = await tx
      .select()
      .from(applicationsTable)
      .where(
        and(
          eq(applicationsTable.jobId, jobId),
          inArray(applicationsTable.status, ["diterima", "selesai"]),
        ),
      )
      .orderBy(applicationsTable.id)
      .for("update");
    const requiredWorkers = Math.max(1, gig.kuota ?? 1);
    const totalPayout = gig.totalWorkerPayout;
    const expectedPayout = calculateTotalWorkerPayout(
      gig.nominal,
      gig.pembayaran,
      gig.jumlahHari,
      requiredWorkers,
    );
    const perWorker = calculateTotalWorkerPayout(
      gig.nominal,
      gig.pembayaran,
      gig.jumlahHari,
      1,
    );
    if (workers.length !== requiredWorkers) {
      return { ok: false as const, error: "workers_incomplete" as const };
    }
    if (
      !Number.isSafeInteger(totalPayout) ||
      totalPayout !== expectedPayout ||
      !Number.isSafeInteger(perWorker) ||
      perWorker <= 0
    ) {
      return { ok: false as const, error: "amount_mismatch" as const };
    }

    const sourceIds = workers.map((worker) => String(worker.id));
    const existingEntries = await tx
      .select()
      .from(walletEntriesTable)
      .where(
        and(
          eq(walletEntriesTable.sourceType, "gig_wage"),
          inArray(walletEntriesTable.sourceId, sourceIds),
        ),
      );
    const existingBySource = new Map(existingEntries.map((entry) => [entry.sourceId, entry]));
    let credited = 0;
    let duplicate = true;
    for (const worker of workers) {
      const sourceId = String(worker.id);
      const existing = existingBySource.get(sourceId);
      if (existing) {
        if (existing.workerId !== worker.workerId || existing.amount !== perWorker) {
          return { ok: false as const, error: "amount_mismatch" as const };
        }
        continue;
      }
      const [entry] = await tx
        .insert(walletEntriesTable)
        .values({
          workerId: worker.workerId,
          sourceType: "gig_wage",
          sourceId,
          amount: perWorker,
          description: `Pencairan upah: ${gig.posisi}`,
        })
        .onConflictDoNothing()
        .returning();
      if (entry) {
        credited += entry.amount;
        duplicate = false;
      }
    }

    const [updatedGig] = await tx
      .update(gigsTable)
      .set({ escrowStatus: "released" })
      .where(eq(gigsTable.id, jobId))
      .returning();
    await tx
      .update(applicationsTable)
      .set({ status: "selesai" })
      .where(
        and(
          eq(applicationsTable.jobId, jobId),
          eq(applicationsTable.status, "diterima"),
        ),
      );
    await tx.insert(adminLogsTable).values({
      adminId,
      action: "FORCE_PAYOUT_JOB",
      targetId: String(jobId),
      reason,
    });

    return {
      ok: true as const,
      gig: updatedGig,
      amount: totalPayout,
      credited,
      duplicate,
      workers,
    };
  });

  if (result.ok) {
    broadcastGig(result.gig);
    for (const worker of result.workers) {
      if (worker.status !== "selesai") {
        broadcastApplicationStatus(worker.id, "selesai", jobId, worker.workerId);
      }
    }
  }
  return result;
}
