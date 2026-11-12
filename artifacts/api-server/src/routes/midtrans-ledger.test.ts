import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, gigsTable, manualPaymentsTable, midtransPaymentsTable, pool, usersTable } from "@workspace/db";
import app from "../app.js";
import { createSession, deleteSession, SESSION_COOKIE } from "../lib/auth.js";

const SERVER_KEY = "SB-Mid-server-test-key";
const cleanups: Array<() => Promise<void>> = [];
const realFetch = globalThis.fetch;
const cancelled: string[] = [];

beforeAll(() => {
  process.env["MIDTRANS_SERVER_KEY"] = SERVER_KEY;
  process.env["APP_BASE_URL"] = "https://example.test";
  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/snap/v1/transactions")) {
      const body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({ token: `snap-${body.transaction_details.order_id}`, redirect_url: `https://pay.test/${body.transaction_details.order_id}` }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    }
    if (u.includes("/v2/") && u.endsWith("/cancel")) {
      cancelled.push(decodeURIComponent(u.split("/v2/")[1]!.replace("/cancel", "")));
      return new Response(JSON.stringify({ status_code: "200", transaction_status: "cancel" }), { status: 200 });
    }
    return realFetch(url, init);
  });
});
afterEach(async () => {
  cancelled.length = 0;
  for (const c of cleanups.splice(0).reverse()) await c();
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await pool.end();
});

async function company() {
  const id = `ml-${randomUUID()}`;
  await db.insert(usersTable).values({ id, email: `${id}@example.test`, passwordHash: "x", name: "PT Uji", role: "perusahaan" });
  const token = await createSession(id);
  cleanups.push(async () => {
    await deleteSession(token);
    await db.delete(usersTable).where(eq(usersTable.id, id));
  });
  return { id, cookie: `${SESSION_COOKIE}=${token}` };
}

async function gigWithInvoice(employerId: string) {
  const id = Number.parseInt(randomUUID().replace(/-/g, "").slice(0, 12), 16) + 1;
  await db.insert(gigsTable).values({
    id, posisi: "Kasir", pembayaran: "per_hari", nominal: 100_000, lat: -6.2, lng: 106.8, employerId,
    paymentStatus: "awaiting_payment", escrowStatus: "pending_payment", escrowAmount: 100_000, adminFeeAmount: 5_000,
  });
  await db.insert(manualPaymentsTable).values({ payerId: employerId, targetType: "gig_escrow", targetId: String(id), amount: 105_000 });
  cleanups.push(async () => {
    await db.delete(midtransPaymentsTable).where(eq(midtransPaymentsTable.jobId, String(id)));
    await db.delete(manualPaymentsTable).where(eq(manualPaymentsTable.targetId, String(id)));
    await db.delete(gigsTable).where(eq(gigsTable.id, id));
  });
  return id;
}

const rows = (gigId: number) =>
  db.select().from(midtransPaymentsTable).where(eq(midtransPaymentsTable.jobId, String(gigId))).orderBy(midtransPaymentsTable.id);

describe("pencatatan dan pembatalan transaksi Midtrans", () => {
  it("bayar lagi mematikan transaksi lama dan mencatat yang baru", async () => {
    const co = await company();
    const gigId = await gigWithInvoice(co.id);

    const first = await request(app).post("/api/payments/midtrans/snap/posting").set("Cookie", co.cookie).send({ jobId: gigId }).expect(200);
    expect(cancelled).toHaveLength(0);
    const second = await request(app).post("/api/payments/midtrans/snap/posting").set("Cookie", co.cookie).send({ jobId: gigId }).expect(200);

    expect(cancelled).toEqual([first.body.orderId]);
    const r = await rows(gigId);
    expect(r.map((x) => [x.orderId, x.status])).toEqual([
      [first.body.orderId, "cancelled"],
      [second.body.orderId, "pending"],
    ]);
    expect(r[1]!.redirectUrl).toContain(second.body.orderId);
  });

  it("notifikasi lunas mengisi metode dan waktu pembayaran di catatan", async () => {
    const co = await company();
    const gigId = await gigWithInvoice(co.id);
    const snap = await request(app).post("/api/payments/midtrans/snap/posting").set("Cookie", co.cookie).send({ jobId: gigId }).expect(200);
    const orderId = snap.body.orderId as string;
    const signature = createHash("sha512").update(`${orderId}200105000${SERVER_KEY}`).digest("hex");
    await request(app)
      .post("/api/payments/midtrans/notification")
      .send({ order_id: orderId, status_code: "200", gross_amount: "105000", signature_key: signature, transaction_status: "settlement", payment_type: "qris" })
      .expect(200);

    const [row] = await rows(gigId);
    expect(row!.status).toBe("paid");
    expect(row!.paymentType).toBe("qris");
    expect(row!.settlementTime).not.toBeNull();
  });

  it("membatalkan lowongan juga mematikan transaksi Midtrans yang masih hidup", async () => {
    const co = await company();
    const gigId = await gigWithInvoice(co.id);
    const snap = await request(app).post("/api/payments/midtrans/snap/posting").set("Cookie", co.cookie).send({ jobId: gigId }).expect(200);

    await request(app).post(`/api/gigs/${gigId}/cancel-unpaid`).set("Cookie", co.cookie).expect(200);
    expect(cancelled).toEqual([snap.body.orderId]);
    expect((await rows(gigId))[0]!.status).toBe("cancelled");
  });

  it("daftar langganan pending kosong untuk akun tanpa transaksi", async () => {
    const co = await company();
    await request(app).get("/api/payments/midtrans/mine").expect(401);
    const res = await request(app).get("/api/payments/midtrans/mine").set("Cookie", co.cookie).expect(200);
    expect(res.body.subscriptions).toEqual([]);
  });
});
