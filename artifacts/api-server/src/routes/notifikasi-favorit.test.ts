import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  applicationsTable,
  db,
  favoriteWorkersTable,
  gigsTable,
  notificationsTable,
  pool,
  ratingsTable,
  usersTable,
  walletEntriesTable,
} from "@workspace/db";
import app from "../app.js";
import { createSession, SESSION_COOKIE } from "../lib/auth.js";
import { notifyByEmail } from "../lib/notify.js";

const cleanups: Array<() => Promise<void>> = [];
const sent: Array<{ to: string[]; subject: string }> = [];

beforeEach(() => {
  sent.length = 0;
  process.env["RESEND_API_KEY"] = "re_test";
  process.env["MAIL_FROM"] = "Rekhastha <no-reply@example.test>";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      if (String(url).includes("api.resend.com")) {
        sent.push(JSON.parse(init?.body ?? "{}"));
        return new Response("{}", { status: 200 });
      }
      throw new Error(`fetch tak terduga: ${url}`);
    }),
  );
});
afterEach(async () => {
  vi.unstubAllGlobals();
  delete process.env["RESEND_API_KEY"];
  delete process.env["MAIL_FROM"];
  for (const c of cleanups.splice(0).reverse()) await c();
});
afterAll(async () => {
  await pool.end();
});

async function user(role: "pekerja" | "perusahaan", extra: Partial<typeof usersTable.$inferInsert> = {}) {
  const id = `nf-${randomUUID()}`;
  await db.insert(usersTable).values({
    id,
    email: `${id}@example.test`,
    passwordHash: "x",
    name: `Uji ${role}`,
    role,
    ...extra,
  });
  const token = await createSession(id);
  cleanups.push(async () => {
    await db.delete(favoriteWorkersTable).where(eq(favoriteWorkersTable.employerId, id));
    await db.delete(notificationsTable).where(eq(notificationsTable.userId, id));
    await db.delete(usersTable).where(eq(usersTable.id, id));
  });
  return { id, email: `${id}@example.test`, cookie: `${SESSION_COOKIE}=${token}` };
}

async function gig(employerId: string) {
  const id = Number.parseInt(randomUUID().replace(/-/g, "").slice(0, 12), 16) + 1;
  await db.insert(gigsTable).values({
    id,
    posisi: "Barista uji",
    pembayaran: "per_hari",
    nominal: 100_000,
    lat: -6.2,
    lng: 106.8,
    employerId,
    paymentStatus: "confirmed",
    escrowStatus: "locked",
    jumlahHari: 1,
    kuota: 1,
    adminFeeAmount: 5000,
    totalWorkerPayout: 95_000,
    escrowAmount: 95_000,
  });
  cleanups.push(async () => {
    await db.delete(gigsTable).where(eq(gigsTable.id, id));
  });
  return id;
}

async function application(jobId: number, workerId: string, employerId: string, status: string, workerName = "Budi Uji") {
  await db.insert(applicationsTable).values({ jobId, workerId, employerId, status, workerName, jobTitle: "Barista uji" });
  cleanups.push(async () => {
    await db.delete(applicationsTable).where(and(eq(applicationsTable.jobId, jobId), eq(applicationsTable.workerId, workerId)));
  });
}

describe("email notifikasi", () => {
  it("terkirim lewat Resend sesuai jenis, dan hormati pengaturan pengguna", async () => {
    const employer = await user("perusahaan");
    await expect(notifyByEmail(employer.id, { kind: "payment", title: "Pembayaran berhasil", detail: "Lowongan tayang." })).resolves.toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual([employer.email]);
    expect(sent[0].subject).toBe("Pembayaran berhasil");

    const off = await user("perusahaan", { notificationPrefs: { payment: false } });
    await expect(notifyByEmail(off.id, { kind: "payment", title: "x", detail: "y" })).resolves.toBe(false);
    expect(sent).toHaveLength(1);
  });

  it("tidak mengirim ke akun ditangguhkan, dan membatasi email pelamar per lowongan", async () => {
    const banned = await user("pekerja", { suspended: true });
    await expect(notifyByEmail(banned.id, { kind: "status", status: "diterima", jobTitle: "X" })).resolves.toBe(false);

    const employer = await user("perusahaan");
    const event = { kind: "applicant", applicantName: "Budi", jobTitle: "Barista", jobId: 424242 } as const;
    await expect(notifyByEmail(employer.id, event)).resolves.toBe(true);
    await expect(notifyByEmail(employer.id, event)).resolves.toBe(false);
    expect(sent).toHaveLength(1);
  });

  it("nama pelamar dengan HTML tidak lolos ke isi email", async () => {
    const employer = await user("perusahaan");
    await notifyByEmail(employer.id, { kind: "applicant", applicantName: "<script>alert(1)</script>", jobTitle: "A", jobId: 777001 });
    const { html } = sent[0] as unknown as { html: string };
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("pengaturan notifikasi bisa disimpan dan hanya menerima kunci yang dikenal", async () => {
    const u = await user("pekerja");
    await request(app).patch("/api/auth/notification-prefs").send({ status: false }).expect(401);
    const res = await request(app)
      .patch("/api/auth/notification-prefs")
      .set("Cookie", u.cookie)
      .send({ status: false, payout: true, hacker: false, role: "admin" })
      .expect(200);
    expect(res.body.notificationPrefs).toEqual({ status: false, payout: true });
    const again = await request(app).patch("/api/auth/notification-prefs").set("Cookie", u.cookie).send({ invite: false }).expect(200);
    expect(again.body.notificationPrefs).toEqual({ status: false, payout: true, invite: false });
  });
});

describe("pekerja favorit dan statistik pelamar", () => {
  it("hanya pekerja yang pernah diterima yang bisa difavoritkan; daftar, hapus", async () => {
    const employer = await user("perusahaan");
    const stranger = await user("pekerja");
    const worker = await user("pekerja");
    const jobId = await gig(employer.id);
    await application(jobId, worker.id, employer.id, "diterima");

    await request(app).put(`/api/favorites/${worker.id}`).expect(401);
    await request(app).put(`/api/favorites/${stranger.id}`).set("Cookie", employer.cookie).expect(403);
    await request(app).put(`/api/favorites/${worker.id}`).set("Cookie", worker.cookie).expect(403);
    await request(app).put(`/api/favorites/${worker.id}`).set("Cookie", employer.cookie).expect(200);
    await request(app).put(`/api/favorites/${worker.id}`).set("Cookie", employer.cookie).expect(200);

    const list = await request(app).get("/api/favorites").set("Cookie", employer.cookie).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].workerId).toBe(worker.id);

    const otherEmployer = await user("perusahaan");
    const other = await request(app).get("/api/favorites").set("Cookie", otherEmployer.cookie).expect(200);
    expect(other.body).toHaveLength(0);

    await request(app).delete(`/api/favorites/${worker.id}`).set("Cookie", employer.cookie).expect(200);
    const after = await request(app).get("/api/favorites").set("Cookie", employer.cookie).expect(200);
    expect(after.body).toHaveLength(0);
  });

  it("undangan: hanya ke favorit, hanya lowongan sendiri yang aktif, sekali per lowongan", async () => {
    const employer = await user("perusahaan");
    const rival = await user("perusahaan");
    const worker = await user("pekerja");
    const jobId = await gig(employer.id);
    const rivalJob = await gig(rival.id);
    await application(jobId, worker.id, employer.id, "selesai");
    await request(app).put(`/api/favorites/${worker.id}`).set("Cookie", employer.cookie).expect(200);

    await request(app).post(`/api/favorites/${worker.id}/invite`).set("Cookie", employer.cookie).send({ jobId: rivalJob }).expect(404);
    await request(app).post(`/api/favorites/${worker.id}/invite`).set("Cookie", rival.cookie).send({ jobId: rivalJob }).expect(404);
    await request(app).post(`/api/favorites/${worker.id}/invite`).set("Cookie", employer.cookie).send({ jobId: "x" }).expect(400);

    await request(app).post(`/api/favorites/${worker.id}/invite`).set("Cookie", employer.cookie).send({ jobId }).expect(200);
    await request(app).post(`/api/favorites/${worker.id}/invite`).set("Cookie", employer.cookie).send({ jobId }).expect(429);
    const notes = await db.select().from(notificationsTable).where(eq(notificationsTable.userId, worker.id));
    expect(notes.map((n) => n.type)).toContain("invite");
  });

  it("daftar pelamar memuat statistik, skill, foto, dan penanda favorit", async () => {
    const employer = await user("perusahaan");
    const worker = await user("pekerja", { skills: ["Barista", "Kasir"], avatarUrl: "/api/uploads/avatar/a.jpg" });
    const jobId = await gig(employer.id);
    await application(jobId, worker.id, employer.id, "selesai", "Budi Uji");
    const [rating] = await db.insert(ratingsTable).values({ raterId: employer.id, raterType: "company", targetName: "Budi Uji", score: 5, jobId }).returning();
    cleanups.push(async () => {
      await db.delete(ratingsTable).where(eq(ratingsTable.id, rating.id));
    });
    await request(app).put(`/api/favorites/${worker.id}`).set("Cookie", employer.cookie).expect(200);

    const res = await request(app).get("/api/applications").set("Cookie", employer.cookie).expect(200);
    const row = res.body.find((r: { workerId: string }) => r.workerId === worker.id);
    expect(row.workerStats).toEqual({ ratingAvg: 5, ratingCount: 1, completedJobs: 1 });
    expect(row.workerSkills).toEqual(["Barista", "Kasir"]);
    expect(row.workerAvatarUrl).toBe("/api/uploads/avatar/a.jpg");
    expect(row.isFavorite).toBe(true);
  });
});

describe("invoice dan slip", () => {
  it("invoice hanya untuk pemilik lowongan yang sudah dibayar", async () => {
    const employer = await user("perusahaan");
    const rival = await user("perusahaan");
    const worker = await user("pekerja");
    const jobId = await gig(employer.id);

    await request(app).get(`/api/receipts/invoice/${jobId}`).expect(401);
    await request(app).get(`/api/receipts/invoice/${jobId}`).set("Cookie", rival.cookie).expect(404);
    await request(app).get(`/api/receipts/invoice/${jobId}`).set("Cookie", worker.cookie).expect(401);
    const ok = await request(app).get(`/api/receipts/invoice/${jobId}`).set("Cookie", employer.cookie).expect(200);
    expect(ok.headers["content-type"]).toContain("text/html");
    expect(ok.headers["cache-control"]).toContain("no-store");
    expect(ok.text).toContain(`INV-${jobId}`);
    expect(ok.text).toContain("Barista uji");
  });

  it("slip hanya untuk pemilik entri dompet", async () => {
    const worker = await user("pekerja");
    const other = await user("pekerja");
    const [entry] = await db
      .insert(walletEntriesTable)
      .values({ workerId: worker.id, sourceType: "test_slip", sourceId: randomUUID(), amount: 95_000, description: "<b>Upah uji</b>" })
      .returning();
    cleanups.push(async () => {
      await db.delete(walletEntriesTable).where(eq(walletEntriesTable.id, entry.id));
    });
    await request(app).get(`/api/receipts/slip/${entry.id}`).set("Cookie", other.cookie).expect(404);
    const ok = await request(app).get(`/api/receipts/slip/${entry.id}`).set("Cookie", worker.cookie).expect(200);
    expect(ok.text).toContain(`SLP-${entry.id}`);
    expect(ok.text).not.toContain("<b>Upah uji</b>");
  });
});
