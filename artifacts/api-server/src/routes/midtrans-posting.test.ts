import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createHash, randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  gigsTable,
  instantOrdersTable,
  manualPaymentsTable,
  notificationsTable,
  pool,
  usersTable,
} from "@workspace/db";
import app from "../app.js";
import { createSession, deleteSession, SESSION_COOKIE } from "../lib/auth.js";

const SERVER_KEY = "SB-Mid-server-test-key";
const cleanups: Array<() => Promise<void>> = [];
const realFetch = globalThis.fetch;
const snapBodies: Array<{ transaction_details: { order_id: string; gross_amount: number }; item_details: Array<{ price: number; quantity: number }> }> = [];
let statusLookup: "not_found" | { status: string; gross: string } = "not_found";

beforeAll(() => {
  process.env["MIDTRANS_SERVER_KEY"] = SERVER_KEY;
  process.env["APP_BASE_URL"] = "https://example.test";
  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/snap/v1/transactions")) {
      const body = JSON.parse(String(init?.body));
      snapBodies.push(body);
      return new Response(
        JSON.stringify({ token: `snap-${body.transaction_details.order_id}`, redirect_url: "https://app.sandbox.midtrans.com/x" }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    }
    if (u.includes("/v2/") && u.endsWith("/status")) {
      const orderId = decodeURIComponent(u.split("/v2/")[1]!.replace("/status", ""));
      if (statusLookup === "not_found") {
        return new Response(JSON.stringify({ status_code: "404", status_message: "Not found" }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ status_code: "200", order_id: orderId, transaction_status: statusLookup.status, gross_amount: statusLookup.gross }),
        { status: 200 },
      );
    }
    return realFetch(url, init);
  });
});

afterEach(async () => {
  statusLookup = "not_found";
  for (const c of cleanups.splice(0).reverse()) await c();
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await pool.end();
});

async function makeCompany() {
  const id = `mp-test-${randomUUID()}`;
  await db.insert(usersTable).values({
    id, email: `${id}@example.test`, passwordHash: "x", name: "PT Uji", role: "perusahaan",
  });
  const token = await createSession(id);
  const gigIds: number[] = [];
  cleanups.push(async () => {
    await deleteSession(token);
    if (gigIds.length) {
      await db.delete(instantOrdersTable).where(inArray(instantOrdersTable.jobId, gigIds));
      await db.delete(manualPaymentsTable).where(inArray(manualPaymentsTable.targetId, gigIds.map(String)));
      await db.delete(gigsTable).where(inArray(gigsTable.id, gigIds));
    }
    await db.delete(notificationsTable).where(eq(notificationsTable.userId, id));
    await db.delete(usersTable).where(eq(usersTable.id, id));
  });
  return { id, token, gigIds, cookie: `${SESSION_COOKIE}=${token}` };
}

let nextId = 7_000_000 + Math.floor(Math.random() * 1_000_000);
function gigPayload(mode: "cepat" | "lama") {
  return {
    id: nextId++,
    posisi: "Kasir Uji",
    deskripsi: "Tes",
    pembayaran: "per_hari",
    nominal: 150_000,
    kuota: 2,
    jumlahHari: 1,
    lat: -6.2,
    lng: 106.8,
    hiringMode: mode,
    jobCategory: "umum",
    namaPerusahaan: "PT Uji",
  };
}

async function createGig(co: Awaited<ReturnType<typeof makeCompany>>, mode: "cepat" | "lama") {
  const res = await request(app).post("/api/gigs").set("Cookie", co.cookie).send(gigPayload(mode));
  expect(res.status).toBe(201);
  co.gigIds.push(res.body.id);
  return res.body as { id: number; escrowAmount: number; adminFeeAmount: number; manualPaymentId: number };
}

const sign = (o: string, c: string, g: string) =>
  createHash("sha512").update(`${o}${c}${g}${SERVER_KEY}`).digest("hex");
const notif = (orderId: string, gross: string, status = "settlement") => ({
  order_id: orderId, status_code: "200", gross_amount: gross,
  signature_key: sign(orderId, "200", gross), transaction_status: status, payment_type: "qris",
});

async function gigRow(id: number) {
  const [g] = await db.select().from(gigsTable).where(eq(gigsTable.id, id));
  return g!;
}
async function invoice(gigId: number) {
  const [m] = await db.select().from(manualPaymentsTable).where(eq(manualPaymentsTable.targetId, String(gigId)));
  return m!;
}

describe("pembuatan lowongan terhubung ke Midtrans", () => {
  it("lowongan dibuat tanpa rekening manual; Snap menagih upah + biaya persis tagihan", async () => {
    const co = await makeCompany();
    const gig = await createGig(co, "lama"); // 201 walau admin belum mengisi rekening manual

    expect(gig.escrowAmount).toBe(300_000); // 150.000 x 2 pekerja
    const fee = gig.adminFeeAmount;
    snapBodies.length = 0;
    const res = await request(app)
      .post("/api/payments/midtrans/snap/posting")
      .set("Cookie", co.cookie)
      .send({ jobId: gig.id }); // angka, persis kiriman frontend
    expect(res.status).toBe(200);
    expect(res.body.amount).toBe(300_000 + fee);
    expect(res.body.wage).toBe(300_000);

    const sent = snapBodies[0]!;
    expect(sent.transaction_details.gross_amount).toBe(300_000 + fee);
    const itemSum = sent.item_details.reduce((n, i) => n + i.price * i.quantity, 0);
    expect(itemSum).toBe(sent.transaction_details.gross_amount); // syarat Midtrans
    expect((await invoice(gig.id)).amount).toBe(300_000 + fee);
  });

  it("webhook lunas (Lama): lowongan tayang, escrow terkunci, tagihan manual ditutup, idempoten", async () => {
    const co = await makeCompany();
    const gig = await createGig(co, "lama");
    const snap = await request(app).post("/api/payments/midtrans/snap/posting").set("Cookie", co.cookie).send({ jobId: gig.id });
    const gross = `${snap.body.amount}.00`;

    expect((await gigRow(gig.id)).paymentStatus).toBe("awaiting_payment");
    const w1 = await request(app).post("/api/payments/midtrans/notification").send(notif(snap.body.orderId, gross));
    expect(w1.status).toBe(200);
    expect(w1.body.ok).toBe(true);

    const g = await gigRow(gig.id);
    expect(g.paymentStatus).toBe("confirmed");
    expect(g.escrowStatus).toBe("locked");
    expect(g.broadcastActive).toBe(false); // bukan Instan Kilat
    const inv = await invoice(gig.id);
    expect(inv.status).toBe("confirmed");
    expect(inv.transferReference).toBe(snap.body.orderId);
    expect(inv.reviewedBy).toBe("midtrans");

    // kirim ulang -> tidak ada efek tambahan
    const w2 = await request(app).post("/api/payments/midtrans/notification").send(notif(snap.body.orderId, gross));
    expect(w2.status).toBe(200);
    expect((await gigRow(gig.id)).escrowStatus).toBe("locked");

    // lowongan yang sudah dibayar tidak bisa ditagih lagi
    const again = await request(app).post("/api/payments/midtrans/snap/posting").set("Cookie", co.cookie).send({ jobId: gig.id });
    expect(again.status).toBe(409);
  });

  it("Instan Kilat: webhook mengaktifkan broadcast dan order Instan Kilat", async () => {
    const co = await makeCompany();
    const gig = await createGig(co, "cepat");
    const ord = await request(app).post("/api/instant-orders").set("Cookie", co.cookie).send({ jobId: gig.id, category: "umum" });
    expect(ord.status).toBe(201); // tanpa rekening manual pun jalan

    const snap = await request(app).post("/api/payments/midtrans/snap/posting").set("Cookie", co.cookie).send({ jobId: gig.id });
    await request(app).post("/api/payments/midtrans/notification").send(notif(snap.body.orderId, `${snap.body.amount}.00`));

    const g = await gigRow(gig.id);
    expect(g.paymentStatus).toBe("confirmed");
    expect(g.broadcastActive).toBe(true);
    const [o] = await db.select().from(instantOrdersTable).where(eq(instantOrdersTable.jobId, gig.id));
    expect(o!.status).toBe("active");
  });

  it("menolak nominal yang tidak cocok, status pending/expire, dan signature palsu", async () => {
    const co = await makeCompany();
    const gig = await createGig(co, "lama");
    const snap = await request(app).post("/api/payments/midtrans/snap/posting").set("Cookie", co.cookie).send({ jobId: gig.id });
    const orderId: string = snap.body.orderId;

    // signature sah tetapi nominal lebih kecil (hanya biaya, tanpa upah)
    const cheap = await request(app).post("/api/payments/midtrans/notification").send(notif(orderId, `${snap.body.fee}.00`));
    expect(cheap.body.ok).toBe(false);
    expect((await gigRow(gig.id)).paymentStatus).toBe("awaiting_payment");

    // pending & expire tidak mengaktifkan
    await request(app).post("/api/payments/midtrans/notification").send(notif(orderId, `${snap.body.amount}.00`, "pending"));
    await request(app).post("/api/payments/midtrans/notification").send(notif(orderId, `${snap.body.amount}.00`, "expire"));
    expect((await gigRow(gig.id)).paymentStatus).toBe("awaiting_payment");

    // signature palsu + Midtrans tidak mengenal order -> ditolak
    const forged = { ...notif(orderId, `${snap.body.amount}.00`), signature_key: "deadbeef" };
    expect((await request(app).post("/api/payments/midtrans/notification").send(forged)).status).toBe(401);
    expect((await gigRow(gig.id)).paymentStatus).toBe("awaiting_payment");

    // signature palsu tetapi Midtrans sendiri menyatakan settlement -> diterima via Get Status API
    statusLookup = { status: "settlement", gross: `${snap.body.amount}.00` };
    const viaApi = await request(app).post("/api/payments/midtrans/notification").send(forged);
    expect(viaApi.status).toBe(200);
    expect((await gigRow(gig.id)).paymentStatus).toBe("confirmed");
  });

  it("serangan: custom_field tidak bisa mengalihkan aktivasi ke lowongan lain", async () => {
    const attacker = await makeCompany();
    const victim = await makeCompany();
    const mine = await createGig(attacker, "lama");
    const theirs = await createGig(victim, "lama");
    const snap = await request(app).post("/api/payments/midtrans/snap/posting").set("Cookie", attacker.cookie).send({ jobId: mine.id });

    await request(app).post("/api/payments/midtrans/notification").send({
      ...notif(snap.body.orderId, `${snap.body.amount}.00`),
      custom_field1: "posting", custom_field2: String(theirs.id), custom_field3: victim.id,
    });
    expect((await gigRow(theirs.id)).paymentStatus).toBe("awaiting_payment");
    expect((await gigRow(mine.id)).paymentStatus).toBe("confirmed");
  });

  it("lowongan milik perusahaan lain ditolak (403)", async () => {
    const a = await makeCompany();
    const b = await makeCompany();
    const gig = await createGig(b, "lama");
    const res = await request(app).post("/api/payments/midtrans/snap/posting").set("Cookie", a.cookie).send({ jobId: gig.id });
    expect(res.status).toBe(403);
  });

  it("endpoint status melaporkan posting yang sudah dibayar", async () => {
    const co = await makeCompany();
    const gig = await createGig(co, "lama");
    const snap = await request(app).post("/api/payments/midtrans/snap/posting").set("Cookie", co.cookie).send({ jobId: gig.id });
    const before = await request(app).get(`/api/payments/midtrans/status/${snap.body.orderId}`).set("Cookie", co.cookie);
    expect(before.body.order.status).toBe("pending");
    await request(app).post("/api/payments/midtrans/notification").send(notif(snap.body.orderId, `${snap.body.amount}.00`));
    const after = await request(app).get(`/api/payments/midtrans/status/${snap.body.orderId}`).set("Cookie", co.cookie);
    expect(after.body.order.status).toBe("paid");
  });
});
