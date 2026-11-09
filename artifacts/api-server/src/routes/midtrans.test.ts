import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import {
  adminLogsTable,
  db,
  gigsTable,
  instantOrdersTable,
  manualPaymentsTable,
  midtransPaymentsTable,
  pool,
  subscriptionOrdersTable,
  subscriptionPlansTable,
  usersTable,
} from "@workspace/db";
import app from "../app.js";
import { createSession, deleteSession, SESSION_COOKIE } from "../lib/auth.js";

const SERVER_KEY = "SB-Mid-server-testkey";
const CLIENT_KEY = "SB-Mid-client-testkey";

const cleanups: Array<() => Promise<void>> = [];

// ── Fake Midtrans (Snap + Status API), installed at the fetch layer ─────────
type RemoteStatus = {
  transaction_status: string;
  fraud_status?: string;
  gross_amount: string;
  payment_type?: string;
};
const remote = new Map<string, RemoteStatus>();
const snapRequests: Array<Record<string, any>> = [];
let fetchMock: ReturnType<typeof vi.spyOn>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeAll(() => {
  fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/snap/v1/transactions")) {
      const body = JSON.parse(String(init?.body)) as Record<string, any>;
      snapRequests.push(body);
      const orderId = body.transaction_details.order_id as string;
      return jsonResponse(
        { token: `tok-${orderId}`, redirect_url: `https://app.sandbox.midtrans.com/snap/v4/${orderId}` },
        201,
      );
    }
    const status = /\/v2\/([^/]+)\/status$/.exec(url);
    if (status) {
      const orderId = decodeURIComponent(status[1]!);
      const state = remote.get(orderId);
      if (!state) return jsonResponse({ status_code: "404", status_message: "not found" });
      return jsonResponse({
        status_code: "200",
        order_id: orderId,
        transaction_id: `tx-${orderId}`,
        transaction_time: "2026-11-08 18:00:00",
        settlement_time: "2026-11-08 18:01:00",
        ...state,
      });
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  });
});

beforeEach(() => {
  process.env["MIDTRANS_SERVER_KEY"] = SERVER_KEY;
  process.env["MIDTRANS_CLIENT_KEY"] = CLIENT_KEY;
  delete process.env["MIDTRANS_IS_PRODUCTION"];
  process.env["APP_BASE_URL"] = "https://app.example.test";
  remote.clear();
  snapRequests.length = 0;
  fetchMock.mockClear();
});

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

afterAll(async () => {
  fetchMock.mockRestore();
  await pool.end();
});

// ── Fixtures ────────────────────────────────────────────────────────────────
async function createUser(
  role: "pekerja" | "perusahaan" = "perusahaan",
  extra: Partial<typeof usersTable.$inferInsert> = {},
): Promise<{ id: string; token: string }> {
  const id = `midtrans-test-${randomUUID()}`;
  await db.insert(usersTable).values({
    id,
    email: `${id}@example.test`,
    passwordHash: "test-only-not-a-real-password-hash",
    name: "Midtrans test",
    role,
    ...extra,
  });
  cleanups.push(async () => {
    await db.delete(midtransPaymentsTable).where(eq(midtransPaymentsTable.userId, id));
    await db.delete(manualPaymentsTable).where(eq(manualPaymentsTable.payerId, id));
    await db.delete(subscriptionOrdersTable).where(eq(subscriptionOrdersTable.companyId, id));
    await db.delete(instantOrdersTable).where(eq(instantOrdersTable.companyId, id));
    await db.delete(gigsTable).where(eq(gigsTable.employerId, id));
    await db.delete(usersTable).where(eq(usersTable.id, id));
  });
  const token = await createSession(id);
  cleanups.push(async () => {
    await deleteSession(token);
  });
  return { id, token };
}

const WAGE = 100_000;
const FEE = 50_000;

/** A gig exactly as POST /gigs leaves it: awaiting payment, with its bill. */
async function createGigWithBill(employerId: string, hiringMode: "cepat" | "lama" = "cepat") {
  const gigId = Number.parseInt(randomUUID().replace(/-/g, "").slice(0, 12), 16) + 1;
  await db.insert(gigsTable).values({
    id: gigId,
    posisi: "Pekerjaan uji",
    pembayaran: "per_hari",
    nominal: WAGE,
    lat: -6.2,
    lng: 106.8,
    employerId,
    employerName: "Uji",
    hiringMode,
    escrowAmount: WAGE,
    escrowStatus: "pending_payment",
    adminFeeAmount: FEE,
    totalWorkerPayout: WAGE,
    paymentStatus: "awaiting_payment",
    broadcastActive: false,
  });
  const [bill] = await db
    .insert(manualPaymentsTable)
    .values({
      payerId: employerId,
      targetType: "gig_escrow",
      targetId: String(gigId),
      amount: WAGE + FEE,
    })
    .returning();
  if (hiringMode === "cepat") {
    await db.insert(instantOrdersTable).values({ jobId: gigId, companyId: employerId, amount: FEE });
  }
  return { gigId, bill: bill! };
}

async function loadGig(gigId: number) {
  const [gig] = await db.select().from(gigsTable).where(eq(gigsTable.id, gigId));
  return gig!;
}
async function loadBill(id: number) {
  const [bill] = await db.select().from(manualPaymentsTable).where(eq(manualPaymentsTable.id, id));
  return bill!;
}
async function loadLedger(orderId: string) {
  const [row] = await db
    .select()
    .from(midtransPaymentsTable)
    .where(eq(midtransPaymentsTable.orderId, orderId));
  return row!;
}

// The API sits behind one proxy hop (`trust proxy 1`), so the right-most
// X-Forwarded-For entry is the client. Give every request its own address so
// the per-IP rate limiter does not couple unrelated tests together.
let nextIp = 1;
const freshIp = () => `203.0.113.${(nextIp++ % 250) + 1}`;

function pay(token: string, path: string, body: unknown = {}, ip: string = freshIp()) {
  return request(app)
    .post(path)
    .set("X-Forwarded-For", ip)
    .set("Cookie", `${SESSION_COOKIE}=${token}`)
    .send(body as object);
}

/** What Midtrans POSTs to our notification URL. Only the signed fields matter. */
function notify(orderId: string, grossAmount: string, extra: Record<string, unknown> = {}) {
  const statusCode = "200";
  const signature = createHash("sha512")
    .update(`${orderId}${statusCode}${grossAmount}${SERVER_KEY}`)
    .digest("hex");
  return request(app)
    .post("/api/payments/midtrans/notification")
    .send({
      order_id: orderId,
      status_code: statusCode,
      gross_amount: grossAmount,
      signature_key: signature,
      transaction_status: "settlement",
      ...extra,
    });
}

function settled(orderId: string, amount: number, extra: Partial<RemoteStatus> = {}) {
  remote.set(orderId, {
    transaction_status: "settlement",
    gross_amount: `${amount}.00`,
    payment_type: "bank_transfer",
    ...extra,
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────
describe("creating a Snap order for a posting", () => {
  it("requires a login and an employer account", async () => {
    await request(app).post("/api/payments/midtrans/snap/posting").send({ jobId: 1 }).expect(401);
    const worker = await createUser("pekerja");
    await pay(worker.token, "/api/payments/midtrans/snap/posting", { jobId: 1 }).expect(403);
  });

  it("charges the server-side bill (wages + fee) and ignores any amount from the browser", async () => {
    const employer = await createUser();
    const { gigId, bill } = await createGigWithBill(employer.id);

    const res = await pay(employer.token, "/api/payments/midtrans/snap/posting", {
      jobId: gigId,
      amount: 1,
      grossAmount: 1,
      price: 1,
    }).expect(201);

    expect(res.body.amount).toBe(WAGE + FEE);
    expect(res.body.manualPaymentId).toBe(bill.id);
    expect(res.body.snapToken).toBe(`tok-${res.body.orderId}`);
    // The client key and snap.js URL come from the server so they cannot disagree.
    expect(res.body.clientKey).toBe(CLIENT_KEY);
    expect(res.body.snapJsUrl).toBe("https://app.sandbox.midtrans.com/snap/snap.js");

    expect(snapRequests).toHaveLength(1);
    expect(snapRequests[0]!.transaction_details.gross_amount).toBe(WAGE + FEE);
    expect(snapRequests[0]!.item_details[0].price).toBe(WAGE + FEE);

    const ledger = await loadLedger(res.body.orderId);
    expect(ledger).toMatchObject({
      userId: employer.id,
      manualPaymentId: bill.id,
      grossAmount: WAGE + FEE,
      status: "pending",
    });
  });

  it("does not let another employer pay or probe someone else's gig", async () => {
    const owner = await createUser();
    const other = await createUser();
    const { gigId } = await createGigWithBill(owner.id);
    await pay(other.token, "/api/payments/midtrans/snap/posting", { jobId: gigId }).expect(404);
    expect(snapRequests).toHaveLength(0);
  });

  it("reuses the open order instead of creating a second one the customer could pay twice", async () => {
    const employer = await createUser();
    const { gigId } = await createGigWithBill(employer.id);
    const first = await pay(employer.token, "/api/payments/midtrans/snap/posting", { jobId: gigId }).expect(201);
    const second = await pay(employer.token, "/api/payments/midtrans/snap/posting", { jobId: gigId }).expect(200);
    expect(second.body.reused).toBe(true);
    expect(second.body.orderId).toBe(first.body.orderId);
    expect(snapRequests).toHaveLength(1);
  });

  it("refuses to bill a gig that is already paid, or whose transfer proof is under review", async () => {
    const employer = await createUser();
    const paid = await createGigWithBill(employer.id);
    await db.update(gigsTable).set({ paymentStatus: "confirmed" }).where(eq(gigsTable.id, paid.gigId));
    await pay(employer.token, "/api/payments/midtrans/snap/posting", { jobId: paid.gigId }).expect(409);

    const reviewing = await createGigWithBill(employer.id);
    await db
      .update(manualPaymentsTable)
      .set({ status: "under_review" })
      .where(eq(manualPaymentsTable.id, reviewing.bill.id));
    const res = await pay(employer.token, "/api/payments/midtrans/snap/posting", { jobId: reviewing.gigId }).expect(409);
    expect(res.body.error).toMatch(/ditinjau admin/);
    expect(snapRequests).toHaveLength(0);
  });

  it("answers 503 with a clear message when Midtrans is not configured, without calling Midtrans", async () => {
    const employer = await createUser();
    const { gigId } = await createGigWithBill(employer.id);
    delete process.env["MIDTRANS_CLIENT_KEY"];
    const res = await pay(employer.token, "/api/payments/midtrans/snap/posting", { jobId: gigId }).expect(503);
    expect(res.body.error).toMatch(/belum tersedia/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("also works through the generic endpoint, scoped to the bill's owner", async () => {
    const employer = await createUser();
    const other = await createUser();
    const { bill } = await createGigWithBill(employer.id);
    await pay(other.token, "/api/payments/midtrans/create", { manualPaymentId: bill.id }).expect(404);
    const res = await pay(employer.token, "/api/payments/midtrans/create", { manualPaymentId: bill.id }).expect(201);
    expect(res.body.amount).toBe(WAGE + FEE);
  });
});

describe("rate limiting", () => {
  it("limits payment attempts per client address and cannot be dodged by spoofing X-Forwarded-For", async () => {
    const employer = await createUser();
    const attacker = "198.51.100.77";
    let limited = 0;
    for (let i = 0; i < 14; i++) {
      // The client prepends a fresh fake address each time; the proxy-appended,
      // right-most entry stays the same.
      const res = await request(app)
        .post("/api/payments/midtrans/snap/posting")
        .set("X-Forwarded-For", `10.0.0.${i}, ${attacker}`)
        .set("Cookie", `${SESSION_COOKIE}=${employer.token}`)
        .send({ jobId: 1 });
      if (res.status === 429) limited++;
    }
    expect(limited).toBeGreaterThanOrEqual(4);
  });

  it("never rate-limits Midtrans' own notifications", async () => {
    for (let i = 0; i < 15; i++) {
      await request(app)
        .post("/api/payments/midtrans/notification")
        .set("X-Forwarded-For", "198.51.100.88")
        .send({ hello: "world" })
        .expect(400); // rejected for the body, not for the rate
    }
  });
});

describe("Midtrans notification", () => {
  async function startOrder(hiringMode: "cepat" | "lama" = "cepat") {
    const employer = await createUser();
    const { gigId, bill } = await createGigWithBill(employer.id, hiringMode);
    const res = await pay(employer.token, "/api/payments/midtrans/snap/posting", { jobId: gigId }).expect(201);
    return { employer, gigId, bill, orderId: res.body.orderId as string };
  }

  it("rejects a bad signature and changes nothing", async () => {
    const { gigId, bill, orderId } = await startOrder();
    settled(orderId, WAGE + FEE);
    await request(app)
      .post("/api/payments/midtrans/notification")
      .send({ order_id: orderId, status_code: "200", gross_amount: `${WAGE + FEE}.00`, signature_key: "0".repeat(128) })
      .expect(401);
    expect((await loadGig(gigId)).paymentStatus).toBe("awaiting_payment");
    expect((await loadBill(bill.id)).status).toBe("awaiting_payment");
  });

  it("rejects a malformed body", async () => {
    await request(app).post("/api/payments/midtrans/notification").send({ hello: "world" }).expect(400);
  });

  it("funds the escrow and activates the instant gig exactly once, even when notified repeatedly", async () => {
    const { gigId, bill, orderId } = await startOrder("cepat");
    settled(orderId, WAGE + FEE);

    await notify(orderId, `${WAGE + FEE}.00`).expect(200);

    const gig = await loadGig(gigId);
    expect(gig).toMatchObject({ paymentStatus: "confirmed", escrowStatus: "locked", broadcastActive: true });
    const [instant] = await db.select().from(instantOrdersTable).where(eq(instantOrdersTable.jobId, gigId));
    expect(instant!.status).toBe("active");
    const confirmed = await loadBill(bill.id);
    expect(confirmed).toMatchObject({ status: "confirmed", reviewedBy: `midtrans:${orderId}` });
    expect((await loadLedger(orderId)).status).toBe("paid");

    // Midtrans retries and the browser polls: none of it may apply the payment again.
    await notify(orderId, `${WAGE + FEE}.00`).expect(200);
    await notify(orderId, `${WAGE + FEE}.00`).expect(200);
    const logs = await db
      .select()
      .from(adminLogsTable)
      .where(and(eq(adminLogsTable.action, "CONFIRM_MIDTRANS_PAYMENT"), eq(adminLogsTable.targetId, String(bill.id))));
    expect(logs).toHaveLength(1);
  });

  it("does not trust what the notification body says: the real state comes from Midtrans", async () => {
    const { gigId, orderId } = await startOrder();
    // The (signed) notification claims settlement, but Midtrans still says pending.
    remote.set(orderId, { transaction_status: "pending", gross_amount: `${WAGE + FEE}.00` });
    await notify(orderId, `${WAGE + FEE}.00`, { transaction_status: "settlement" }).expect(200);
    expect((await loadGig(gigId)).paymentStatus).toBe("awaiting_payment");
    expect((await loadLedger(orderId)).status).toBe("pending");
  });

  it("ignores forged custom fields: only the order in our own ledger is ever activated", async () => {
    const { gigId, orderId } = await startOrder();
    const victim = await createUser();
    const victimGig = await createGigWithBill(victim.id);
    settled(orderId, WAGE + FEE);
    await notify(orderId, `${WAGE + FEE}.00`, {
      custom_field1: "posting",
      custom_field2: String(victimGig.gigId),
      custom_field3: victim.id,
    }).expect(200);
    expect((await loadGig(gigId)).paymentStatus).toBe("confirmed");
    expect((await loadGig(victimGig.gigId)).paymentStatus).toBe("awaiting_payment");
  });

  it("flags a payment whose amount differs from the order and does NOT activate anything", async () => {
    const { gigId, bill, orderId } = await startOrder();
    settled(orderId, 1_000); // Midtrans collected Rp1.000, we asked for Rp150.000
    await notify(orderId, "1000.00").expect(200);
    expect((await loadLedger(orderId)).status).toBe("amount_mismatch");
    expect((await loadGig(gigId)).paymentStatus).toBe("awaiting_payment");
    expect((await loadBill(bill.id)).status).toBe("awaiting_payment");
  });

  it("never lets a late 'pending' or 'expire' undo a payment", async () => {
    const { gigId, orderId } = await startOrder();
    settled(orderId, WAGE + FEE);
    await notify(orderId, `${WAGE + FEE}.00`).expect(200);
    remote.set(orderId, { transaction_status: "expire", gross_amount: `${WAGE + FEE}.00` });
    await notify(orderId, `${WAGE + FEE}.00`).expect(200);
    expect((await loadLedger(orderId)).status).toBe("paid");
    expect((await loadGig(gigId)).paymentStatus).toBe("confirmed");
  });

  it("flags a double payment when an admin already confirmed the same bill by bank transfer", async () => {
    const { gigId, bill, orderId } = await startOrder();
    await db
      .update(manualPaymentsTable)
      .set({ status: "confirmed", reviewedBy: "admin-1" })
      .where(eq(manualPaymentsTable.id, bill.id));
    await db.update(gigsTable).set({ paymentStatus: "confirmed" }).where(eq(gigsTable.id, gigId));
    settled(orderId, WAGE + FEE);
    await notify(orderId, `${WAGE + FEE}.00`).expect(200);
    expect((await loadLedger(orderId)).status).toBe("paid_duplicate");
    expect((await loadBill(bill.id)).reviewedBy).toBe("admin-1");
  });

  it("flags a paid order whose bill changed after the order was created", async () => {
    const { gigId, bill, orderId } = await startOrder();
    await db.update(manualPaymentsTable).set({ amount: WAGE }).where(eq(manualPaymentsTable.id, bill.id));
    settled(orderId, WAGE + FEE);
    await notify(orderId, `${WAGE + FEE}.00`).expect(200);
    expect((await loadLedger(orderId)).status).toBe("paid_unapplied");
    expect((await loadGig(gigId)).paymentStatus).toBe("awaiting_payment");
  });

  it("acknowledges unknown orders with 200 so Midtrans stops retrying", async () => {
    await notify("RKS-UNKNOWN-1", "1000.00").expect(200);
  });

  it("answers 5xx on a transient failure so Midtrans retries later", async () => {
    const { orderId } = await startOrder();
    fetchMock.mockImplementationOnce(async () => {
      throw new Error("network down");
    });
    await notify(orderId, `${WAGE + FEE}.00`).expect(500);
  });
});

describe("order status", () => {
  it("shows the payer the real state, pulling it from Midtrans while the order is open", async () => {
    const employer = await createUser();
    const { gigId } = await createGigWithBill(employer.id);
    const created = await pay(employer.token, "/api/payments/midtrans/snap/posting", { jobId: gigId }).expect(201);
    const orderId = created.body.orderId as string;

    const before = await request(app)
      .get(`/api/payments/midtrans/status/${orderId}`)
      .set("Cookie", `${SESSION_COOKIE}=${employer.token}`)
      .expect(200);
    expect(before.body.status).toBe("pending");

    // The notification never arrived (e.g. dashboard URL not set); polling recovers.
    settled(orderId, WAGE + FEE);
    await new Promise((resolve) => setTimeout(resolve, 4_100));
    const after = await request(app)
      .get(`/api/payments/midtrans/status/${orderId}`)
      .set("Cookie", `${SESSION_COOKIE}=${employer.token}`)
      .expect(200);
    expect(after.body).toMatchObject({ status: "paid", manualPaymentStatus: "confirmed" });
    expect((await loadGig(gigId)).paymentStatus).toBe("confirmed");
  }, 15_000);

  it("is private to the payer", async () => {
    const employer = await createUser();
    const other = await createUser();
    const { gigId } = await createGigWithBill(employer.id);
    const created = await pay(employer.token, "/api/payments/midtrans/snap/posting", { jobId: gigId }).expect(201);
    await request(app).get(`/api/payments/midtrans/status/${created.body.orderId}`).expect(401);
    await request(app)
      .get(`/api/payments/midtrans/status/${created.body.orderId}`)
      .set("Cookie", `${SESSION_COOKIE}=${other.token}`)
      .expect(404);
  });
});

describe("Rekhastha Bisnis subscription", () => {
  async function createPlan(days = 30, price = 149_000) {
    const [plan] = await db
      .insert(subscriptionPlansTable)
      .values({ label: `Uji ${days} hari`, durationMonths: 1, durationDays: days, originalPrice: price * 2, promoPrice: price })
      .returning();
    cleanups.push(async () => {
      await db.delete(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, plan!.id));
    });
    return plan!;
  }

  it("bills the plan's price, reuses an unpaid order, and activates Premium after payment", async () => {
    const plan = await createPlan();
    const employer = await createUser();

    const first = await pay(employer.token, "/api/payments/midtrans/snap/subscription", { planId: plan.id, amount: 1 }).expect(201);
    expect(first.body.amount).toBe(plan.promoPrice);
    const second = await pay(employer.token, "/api/payments/midtrans/snap/subscription", { planId: plan.id }).expect(200);
    expect(second.body.orderId).toBe(first.body.orderId);
    const orders = await db.select().from(subscriptionOrdersTable).where(eq(subscriptionOrdersTable.companyId, employer.id));
    expect(orders).toHaveLength(1);

    settled(first.body.orderId, plan.promoPrice);
    await notify(first.body.orderId, `${plan.promoPrice}.00`).expect(200);

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, employer.id));
    expect(user!.isPremium).toBe(true);
    const days = (user!.expiredAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
    const [order] = await db.select().from(subscriptionOrdersTable).where(eq(subscriptionOrdersTable.companyId, employer.id));
    expect(order).toMatchObject({ status: "success" });
    expect(order!.paidAt).toBeInstanceOf(Date);
  });

  it("adds to the remaining time when renewing early instead of resetting it", async () => {
    const plan = await createPlan(30);
    const employer = await createUser();
    const first = await pay(employer.token, "/api/payments/midtrans/snap/subscription", { planId: plan.id }).expect(201);
    settled(first.body.orderId, plan.promoPrice);
    await notify(first.body.orderId, `${plan.promoPrice}.00`).expect(200);

    const second = await pay(employer.token, "/api/payments/midtrans/snap/subscription", { planId: plan.id }).expect(201);
    expect(second.body.orderId).not.toBe(first.body.orderId);
    settled(second.body.orderId, plan.promoPrice);
    await notify(second.body.orderId, `${plan.promoPrice}.00`).expect(200);

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, employer.id));
    const days = (user!.expiredAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(59.9);
    expect(days).toBeLessThan(60.1);
  });

  it("rejects unknown plans and non-employers", async () => {
    const employer = await createUser();
    await pay(employer.token, "/api/payments/midtrans/snap/subscription", { planId: 999_999_999 }).expect(404);
    const worker = await createUser("pekerja");
    await pay(worker.token, "/api/payments/midtrans/snap/subscription", { planId: 1 }).expect(403);
  });
});
