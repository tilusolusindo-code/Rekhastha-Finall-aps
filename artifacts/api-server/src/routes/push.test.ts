import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool, pushSubscriptionsTable, usersTable } from "@workspace/db";

const sendNotification = vi.fn();
vi.mock("web-push", () => {
  const api = { setVapidDetails: vi.fn(), sendNotification: (...a: unknown[]) => sendNotification(...a) };
  return { ...api, default: api };
});

import app from "../app.js";
import { createSession, deleteSession, SESSION_COOKIE } from "../lib/auth.js";
import { sendPushToUser, isAllowedPushEndpoint } from "../lib/web-push.js";
import { notifyByEmail } from "../lib/notify.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { sendNotification.mockReset(); for (const c of cleanups.splice(0).reverse()) await c(); });
afterAll(async () => { await pool.end(); });
beforeAll(() => {
  process.env["VAPID_PUBLIC_KEY"] = "BPublicKeyForTestsOnly";
  process.env["VAPID_PRIVATE_KEY"] = "privateKeyForTestsOnly";
});

let ipSeq = 1;
async function makeUser(extra: Partial<typeof usersTable.$inferInsert> = {}) {
  const id = `push-test-${randomUUID()}`;
  await db.insert(usersTable).values({ id, email: `${id}@example.test`, passwordHash: "x", name: "Uji Push", role: "pekerja", ...extra });
  const token = await createSession(id);
  cleanups.push(async () => { await deleteSession(token); await db.delete(usersTable).where(eq(usersTable.id, id)); });
  return { id, cookie: `${SESSION_COOKIE}=${token}`, ip: `10.77.${ipSeq++ % 250}.${ipSeq % 250}` };
}
const sub = (host = "fcm.googleapis.com", tail = randomUUID()) => ({
  endpoint: `https://${host}/fcm/send/${tail}`,
  keys: { p256dh: "BPublicKeyPlaceholder1234567890", auth: "authSecret12345" },
});
const post = (u: { cookie: string; ip: string }, body: unknown) =>
  request(app).post("/api/push/subscribe").set("Cookie", u.cookie).set("X-Forwarded-For", u.ip).send(body as object);

describe("Web Push", () => {
  it("hanya menerima endpoint layanan push resmi (anti-SSRF)", () => {
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isAllowedPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/abc")).toBe(true);
    expect(isAllowedPushEndpoint("https://web.push.apple.com/abc")).toBe(true);
    expect(isAllowedPushEndpoint("http://fcm.googleapis.com/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isAllowedPushEndpoint("https://localhost/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com.evil.test/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://user:pw@fcm.googleapis.com/x")).toBe(false);
  });

  it("subscribe butuh login, menolak endpoint luar, dan menyimpan langganan sah", async () => {
    const u = await makeUser();
    await request(app).post("/api/push/subscribe").set("X-Forwarded-For", u.ip).send(sub()).expect(401);
    await post(u, sub("evil.example.com")).expect(400);
    await post(u, { endpoint: "https://fcm.googleapis.com/x" }).expect(400);
    const s = sub();
    await post(u, s).expect(201);
    cleanups.push(async () => { await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.endpoint, s.endpoint)); });
    const rows = await db.select().from(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.userId, u.id));
    expect(rows).toHaveLength(1);
    // mengulang tidak menggandakan baris
    await post(u, s).expect(201);
    expect(await db.select().from(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.userId, u.id))).toHaveLength(1);
  });

  it("perangkat yang dipakai akun lain berpindah ke akun yang sedang login", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const s = sub();
    await post(a, s).expect(201);
    await post(b, s).expect(201);
    cleanups.push(async () => { await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.endpoint, s.endpoint)); });
    expect(await db.select().from(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.userId, a.id))).toHaveLength(0);
    expect(await db.select().from(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.userId, b.id))).toHaveLength(1);
  });

  it("unsubscribe hanya menghapus langganan milik sendiri", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const s = sub();
    await post(a, s).expect(201);
    cleanups.push(async () => { await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.endpoint, s.endpoint)); });
    await request(app).delete("/api/push/subscribe").set("Cookie", b.cookie).set("X-Forwarded-For", b.ip).send({ endpoint: s.endpoint }).expect(200);
    expect(await db.select().from(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.userId, a.id))).toHaveLength(1);
    await request(app).delete("/api/push/subscribe").set("Cookie", a.cookie).set("X-Forwarded-For", a.ip).send({ endpoint: s.endpoint }).expect(200);
    expect(await db.select().from(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.userId, a.id))).toHaveLength(0);
  });

  it("membatasi jumlah perangkat per akun", async () => {
    const u = await makeUser();
    const endpoints: string[] = [];
    for (let i = 0; i < 10; i++) { const s = sub(); endpoints.push(s.endpoint); await post(u, s).expect(201); }
    cleanups.push(async () => { for (const e of endpoints) await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.endpoint, e)); });
    await post(u, sub()).expect(400);
  });

  it("sendPushToUser mengirim ke semua perangkat dan menghapus langganan mati (410)", async () => {
    const u = await makeUser();
    const live = sub(); const dead = sub();
    await post(u, live).expect(201); await post(u, dead).expect(201);
    cleanups.push(async () => { await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.userId, u.id)); });
    sendNotification.mockImplementation(async (s: { endpoint: string }) => {
      if (s.endpoint === dead.endpoint) throw Object.assign(new Error("gone"), { statusCode: 410 });
    });
    const sent = await sendPushToUser(u.id, { title: "Halo", body: "Uji" });
    expect(sent).toBe(1);
    const left = await db.select().from(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.userId, u.id));
    expect(left.map((r) => r.endpoint)).toEqual([live.endpoint]);
    const payload = JSON.parse(sendNotification.mock.calls[0]![1] as string);
    expect(payload).toMatchObject({ title: "Halo", body: "Uji", url: "/" });
  });

  it("notifyByEmail juga mengirim push, dan menghormati pengaturan notifikasi", async () => {
    const u = await makeUser();
    const s = sub();
    await post(u, s).expect(201);
    cleanups.push(async () => { await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.userId, u.id)); });
    sendNotification.mockResolvedValue({});
    await notifyByEmail(u.id, { kind: "status", status: "diterima", jobTitle: "Kasir" });
    await vi.waitFor(() => expect(sendNotification).toHaveBeenCalledTimes(1));
    expect(JSON.parse(sendNotification.mock.calls[0]![1] as string).title).toBe("Lamaran diterima");

    sendNotification.mockClear();
    await db.update(usersTable).set({ notificationPrefs: { status: false } }).where(eq(usersTable.id, u.id));
    await notifyByEmail(u.id, { kind: "status", status: "ditolak", jobTitle: "Kasir" });
    await new Promise((r) => setTimeout(r, 300));
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("config publik hanya mengungkap kunci publik", async () => {
    const res = await request(app).get("/api/push/config").expect(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.publicKey).toBe("BPublicKeyForTestsOnly");
    expect(JSON.stringify(res.body)).not.toContain("privateKeyForTestsOnly");
  });
});
