import { afterAll, afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, gigsTable, manualPaymentsTable, midtransPaymentsTable, pool, usersTable } from "@workspace/db";
import app from "../app.js";
import { createSession, SESSION_COOKIE } from "../lib/auth.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});
afterAll(async () => {
  await pool.end();
});

async function user(role: "pekerja" | "perusahaan") {
  const id = `bb-${randomUUID()}`;
  await db.insert(usersTable).values({ id, email: `${id}@example.test`, passwordHash: "x", name: "Uji", role });
  const token = await createSession(id);
  cleanups.push(async () => {
    await db.delete(usersTable).where(eq(usersTable.id, id));
  });
  return { id, cookie: `${SESSION_COOKIE}=${token}` };
}

async function unpaidGig(employerId: string, hoursOld: number, paymentStatus = "awaiting_payment") {
  const id = Number.parseInt(randomUUID().replace(/-/g, "").slice(0, 12), 16) + 1;
  await db.insert(gigsTable).values({
    id,
    posisi: "Barista",
    pembayaran: "per_hari",
    nominal: 100_000,
    lat: -6.2,
    lng: 106.8,
    employerId,
    paymentStatus,
    escrowStatus: paymentStatus === "confirmed" ? "locked" : "pending_payment",
    escrowAmount: 100_000,
    adminFeeAmount: 5_000,
    postedAt: new Date(Date.now() - hoursOld * 3_600_000),
  });
  cleanups.push(async () => {
    await db.delete(manualPaymentsTable).where(eq(manualPaymentsTable.targetId, String(id)));
    await db.delete(midtransPaymentsTable).where(eq(midtransPaymentsTable.jobId, String(id)));
    await db.delete(gigsTable).where(eq(gigsTable.id, id));
  });
  return id;
}

async function status(id: number) {
  const [g] = await db.select().from(gigsTable).where(eq(gigsTable.id, id));
  return g?.paymentStatus;
}

describe("batalkan lowongan belum dibayar", () => {
  it("pemilik bisa membatalkan; lowongan hilang dari daftar dan tagihan manual ditutup", async () => {
    const co = await user("perusahaan");
    const id = await unpaidGig(co.id, 1);
    await db.insert(manualPaymentsTable).values({ payerId: co.id, targetType: "gig_escrow", targetId: String(id), amount: 105_000 });

    await request(app).post(`/api/gigs/${id}/cancel-unpaid`).expect(401);
    await request(app).post(`/api/gigs/${id}/cancel-unpaid`).set("Cookie", co.cookie).expect(200);
    expect(await status(id)).toBe("cancelled");
    const [mp] = await db.select().from(manualPaymentsTable).where(eq(manualPaymentsTable.targetId, String(id)));
    expect(mp.status).toBe("cancelled");

    const list = await request(app).get("/api/gigs").set("Cookie", co.cookie).expect(200);
    expect(list.body.find((g: { id: number }) => g.id === id)).toBeUndefined();
    await request(app).post(`/api/gigs/${id}/cancel-unpaid`).set("Cookie", co.cookie).expect(409);
  });

  it("bukan pemilik atau pekerja tidak bisa; lowongan yang sudah dibayar tidak bisa dibatalkan", async () => {
    const co = await user("perusahaan");
    const rival = await user("perusahaan");
    const worker = await user("pekerja");
    const id = await unpaidGig(co.id, 1);
    const paid = await unpaidGig(co.id, 1, "confirmed");

    await request(app).post(`/api/gigs/${id}/cancel-unpaid`).set("Cookie", rival.cookie).expect(404);
    await request(app).post(`/api/gigs/${id}/cancel-unpaid`).set("Cookie", worker.cookie).expect(401);
    expect(await status(id)).toBe("awaiting_payment");
    await request(app).post(`/api/gigs/${paid}/cancel-unpaid`).set("Cookie", co.cookie).expect(409);
    expect(await status(paid)).toBe("confirmed");
    await request(app).post(`/api/gigs/abc/cancel-unpaid`).set("Cookie", co.cookie).expect(400);
  });
});

describe("kedaluwarsa otomatis lowongan belum dibayar (24 jam)", () => {
  it("menutup yang lama, membiarkan yang baru, yang dibayar, dan milik orang lain", async () => {
    const co = await user("perusahaan");
    const other = await user("perusahaan");
    const stale = await unpaidGig(co.id, 30);
    const fresh = await unpaidGig(co.id, 5);
    const paidOld = await unpaidGig(co.id, 100, "confirmed");
    const othersStale = await unpaidGig(other.id, 30);

    const list = await request(app).get("/api/gigs").set("Cookie", co.cookie).expect(200);
    expect(await status(stale)).toBe("cancelled");
    expect(await status(fresh)).toBe("awaiting_payment");
    expect(await status(paidOld)).toBe("confirmed");
    expect(await status(othersStale)).toBe("awaiting_payment");
    const ids = list.body.map((g: { id: number }) => g.id);
    expect(ids).toContain(fresh);
    expect(ids).toContain(paidOld);
    expect(ids).not.toContain(stale);
  });

  it("tidak menutup lowongan dengan tautan Midtrans baru atau bukti transfer yang sedang ditinjau", async () => {
    const co = await user("perusahaan");
    const withSnap = await unpaidGig(co.id, 30);
    const withProof = await unpaidGig(co.id, 30);
    await db.insert(midtransPaymentsTable).values({ orderId: `RKS-POST-${withSnap}-${Date.now()}`, jobId: String(withSnap), jobType: "posting", grossAmount: 105_000 });
    await db.insert(manualPaymentsTable).values({ payerId: co.id, targetType: "gig_escrow", targetId: String(withProof), amount: 105_000, status: "submitted" });

    await request(app).get("/api/gigs").set("Cookie", co.cookie).expect(200);
    expect(await status(withSnap)).toBe("awaiting_payment");
    expect(await status(withProof)).toBe("awaiting_payment");
  });
});
