import { afterAll, afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { applicationsTable, db, escrowRefundsTable, gigsTable, pool, usersTable } from "@workspace/db";
import app from "../app.js";
import { refundUnusedEscrows } from "../lib/escrow-refunds.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  delete process.env["CRON_SECRET"];
  for (const c of cleanups.splice(0).reverse()) await c();
});
afterAll(async () => {
  await pool.end();
});

const DAY = 86_400_000;
let seq = 0;

async function setup() {
  const employer = `rf-${randomUUID()}`;
  await db.insert(usersTable).values({ id: employer, email: `${employer}@example.test`, passwordHash: "x", name: "PT Uji", role: "perusahaan" });
  const ids: number[] = [];
  cleanups.push(async () => {
    if (ids.length) {
      await db.delete(escrowRefundsTable).where(inArray(escrowRefundsTable.gigId, ids));
      await db.delete(applicationsTable).where(inArray(applicationsTable.jobId, ids));
      await db.delete(gigsTable).where(inArray(gigsTable.id, ids));
    }
    await db.delete(usersTable).where(eq(usersTable.id, employer));
  });
  async function gig(opts: { jobDaysAgo?: number | null; postedDaysAgo?: number; escrowStatus?: string }) {
    const id = 9_100_000_000 + Math.floor(Math.random() * 1_000_000) * 10 + seq++ % 10;
    ids.push(id);
    await db.insert(gigsTable).values({
      id, posisi: "Kasir", pembayaran: "per_hari", nominal: 100_000, lat: -6.2, lng: 106.8, employerId: employer,
      paymentStatus: "confirmed", escrowStatus: opts.escrowStatus ?? "locked", escrowAmount: 200_000, adminFeeAmount: 5_000,
      jobDate: opts.jobDaysAgo == null ? null : new Date(Date.now() - opts.jobDaysAgo * DAY),
      postedAt: new Date(Date.now() - (opts.postedDaysAgo ?? 1) * DAY),
    });
    return id;
  }
  const status = async (id: number) => (await db.select().from(gigsTable).where(eq(gigsTable.id, id)))[0]!.escrowStatus;
  const refund = async (id: number) => (await db.select().from(escrowRefundsTable).where(eq(escrowRefundsTable.gigId, id)))[0];
  return { employer, gig, status, refund };
}

describe("refund otomatis escrow yang tidak terpakai", () => {
  it("mengembalikan dana lowongan yang lewat tanggal kerja tanpa pekerja diterima", async () => {
    const t = await setup();
    const old = await t.gig({ jobDaysAgo: 5 });
    const undated = await t.gig({ jobDaysAgo: null, postedDaysAgo: 20 });
    await refundUnusedEscrows();

    for (const id of [old, undated]) {
      expect(await t.status(id)).toBe("refunded");
      const r = await t.refund(id);
      expect(r).toMatchObject({ amount: 200_000, source: "auto_unused", status: "pending", employerId: t.employer });
    }
  });

  it("tidak menyentuh lowongan yang masih berlaku, belum lewat masa tenggang, atau punya pekerja diterima", async () => {
    const t = await setup();
    const future = await t.gig({ jobDaysAgo: -2 });
    const grace = await t.gig({ jobDaysAgo: 1 });
    const fresh = await t.gig({ jobDaysAgo: null, postedDaysAgo: 5 });
    const hired = await t.gig({ jobDaysAgo: 10 });
    const unfunded = await t.gig({ jobDaysAgo: 10, escrowStatus: "pending_payment" });
    await db.insert(applicationsTable).values({ jobId: hired, workerId: "w-1", employerId: t.employer, status: "diterima" });
    await refundUnusedEscrows();

    for (const id of [future, grace, fresh, hired]) {
      expect(await t.status(id)).toBe("locked");
      expect(await t.refund(id)).toBeUndefined();
    }
    expect(await t.status(unfunded)).toBe("pending_payment");
  });

  it("idempoten: dijalankan dua kali tidak membuat refund ganda", async () => {
    const t = await setup();
    const id = await t.gig({ jobDaysAgo: 5 });
    await refundUnusedEscrows();
    await refundUnusedEscrows();
    const rows = await db.select().from(escrowRefundsTable).where(eq(escrowRefundsTable.gigId, id));
    expect(rows).toHaveLength(1);
  });

  it("endpoint cron wajib memakai CRON_SECRET", async () => {
    await request(app).get("/api/cron/refund-expired").expect(503);
    process.env["CRON_SECRET"] = "rahasia-uji";
    await request(app).get("/api/cron/refund-expired").expect(401);
    await request(app).get("/api/cron/refund-expired").set("Authorization", "Bearer salah").expect(401);
    const ok = await request(app).get("/api/cron/refund-expired").set("Authorization", "Bearer rahasia-uji").expect(200);
    expect(ok.body.ok).toBe(true);
  });
});
