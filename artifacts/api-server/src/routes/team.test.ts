import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import {
  applicationsTable, attendanceTable, companyTeamMembersTable, db, gigsTable, notificationsTable, pool, usersTable,
} from "@workspace/db";
import app from "../app.js";
import { createSession, deleteSession, SESSION_COOKIE } from "../lib/auth.js";

const cleanups: Array<() => Promise<void>> = [];
const sentEmails: Array<{ to: string[]; subject: string; html?: string }> = [];

beforeEach(() => {
  sentEmails.length = 0;
  process.env["RESEND_API_KEY"] = "re_test";
  process.env["MAIL_FROM"] = "Rekhastha <no-reply@example.test>";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      if (String(url).includes("api.resend.com")) {
        sentEmails.push(JSON.parse(init?.body ?? "{}"));
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
afterAll(async () => { await pool.end(); });

type Acc = { id: string; email: string; token: string; cookie: string };

async function mk(role: "pekerja" | "perusahaan", opts: { plan?: boolean; verified?: boolean } = {}): Promise<Acc> {
  const id = `team-test-${randomUUID()}`;
  await db.insert(usersTable).values({
    id, email: `${id}@example.test`, passwordHash: "x", name: `Tim ${role}`, role,
    expiredAt: role === "perusahaan" && opts.plan !== false ? new Date(Date.now() + 30 * 86400_000) : null,
    isPremium: role === "perusahaan" && opts.plan !== false,
    verificationStatus: opts.verified ? "verified" : "unverified",
  });
  const token = await createSession(id);
  cleanups.push(async () => {
    await deleteSession(token);
    await db.execute(sql`DELETE FROM team_invitations WHERE company_id = ${id} OR email = ${`${id}@example.test`}`);
    await db.delete(notificationsTable).where(eq(notificationsTable.userId, id));
    await db.delete(companyTeamMembersTable).where(or(eq(companyTeamMembersTable.companyId, id), eq(companyTeamMembersTable.memberId, id)));
    await db.delete(usersTable).where(eq(usersTable.id, id));
  });
  return { id, email: `${id}@example.test`, token, cookie: `${SESSION_COOKIE}=${token}` };
}

const as = (a: Acc) => {
  const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const h = (r: request.Test) => r.set("Cookie", a.cookie).set("X-Forwarded-For", ip);
  return {
    get: (p: string) => h(request(app).get(p)),
    post: (p: string) => h(request(app).post(p)),
    patch: (p: string) => h(request(app).patch(p)),
    del: (p: string) => h(request(app).delete(p)),
  };
};

/** Undang lalu terima: kembalikan anggota aktif dengan peran tertentu. */
async function join(company: Acc, member: Acc, role: "hr" | "supervisor") {
  await as(company).post("/api/team/invite").send({ email: member.email, role }).expect(200);
  const inv = await as(member).get("/api/team/invitations/mine").expect(200);
  await as(member).post(`/api/team/invitations/${inv.body.invitations[0].id}/accept`).expect(200);
}

async function fixtureGig(company: Acc) {
  const id = Number.parseInt(randomUUID().replace(/-/g, "").slice(0, 12), 16) + 1;
  await db.insert(gigsTable).values({
    id, posisi: "Barista uji", pembayaran: "per_hari", nominal: 100_000, lat: -6.2, lng: 106.8, employerId: company.id,
    paymentStatus: "confirmed", escrowStatus: "locked", escrowAmount: 100_000, kuota: 2, jumlahHari: 1,
  });
  cleanups.push(async () => {
    await db.delete(attendanceTable).where(eq(attendanceTable.jobId, id));
    await db.delete(applicationsTable).where(eq(applicationsTable.jobId, id));
    await db.delete(gigsTable).where(eq(gigsTable.id, id));
  });
  return id;
}

async function fixtureApplication(gigId: number, company: Acc, worker: Acc, status = "baru") {
  const [row] = await db.insert(applicationsTable).values({
    jobId: gigId, workerId: worker.id, employerId: company.id, status, workerName: "Pelamar Uji", jobTitle: "Barista uji",
    bank: "BCA", rekening: "1234567890", workerNikMasked: "3171********0001", workerNpwpMasked: "12.***.***",
  }).returning({ id: applicationsTable.id });
  return row!.id;
}

describe("undangan tim", () => {
  it("undangan harus diterima (tidak ada penambahan sepihak), lalu anggota aktif", async () => {
    const co = await mk("perusahaan");
    const member = await mk("pekerja");
    const inv = await as(co).post("/api/team/invite").send({ email: member.email, role: "hr" });
    expect(inv.status).toBe(200);
    expect(inv.body.directAdded).toBeUndefined();

    // Belum anggota: tidak tampil di anggota, tidak punya akses, tapi undangannya terlihat.
    let list = await as(co).get("/api/team").expect(200);
    expect(list.body.members).toHaveLength(0);
    expect(list.body.invitations).toHaveLength(1);
    expect((await as(member).get("/api/team/my-membership").expect(200)).body.membership).toBeNull();
    const mine = await as(member).get("/api/team/invitations/mine").expect(200);
    expect(mine.body.invitations).toHaveLength(1);
    expect(mine.body.invitations[0].role).toBe("hr");
    expect(sentEmails.some((m) => m.to.includes(member.email))).toBe(true);

    await as(member).post(`/api/team/invitations/${mine.body.invitations[0].id}/accept`).expect(200);
    list = await as(co).get("/api/team").expect(200);
    expect(list.body.members).toHaveLength(1);
    expect(list.body.members[0].member_id).toBe(member.id);
    expect(list.body.invitations).toHaveLength(0);

    const me = await as(member).get("/api/team/my-membership").expect(200);
    expect(me.body.membership).toMatchObject({ companyId: co.id, role: "hr" });
    expect(me.body.membership.permissions).toContain("applications.decide");
  });

  it("menolak undangan menghapusnya; orang lain tidak bisa menerimanya", async () => {
    const co = await mk("perusahaan");
    const member = await mk("pekerja");
    const stranger = await mk("pekerja");
    await as(co).post("/api/team/invite").send({ email: member.email, role: "supervisor" }).expect(200);
    const id = (await as(member).get("/api/team/invitations/mine")).body.invitations[0].id;
    await as(stranger).post(`/api/team/invitations/${id}/accept`).expect(404);
    await as(member).post(`/api/team/invitations/${id}/decline`).expect(200);
    expect((await as(member).get("/api/team/invitations/mine")).body.invitations).toHaveLength(0);
    await as(member).post(`/api/team/invitations/${id}/accept`).expect(404);
  });

  it("pemilik bisa membatalkan undangan tertunda; undangan ulang tidak menggandakan", async () => {
    const co = await mk("perusahaan");
    const member = await mk("pekerja");
    await as(co).post("/api/team/invite").send({ email: member.email, role: "hr" }).expect(200);
    await as(co).post("/api/team/invite").send({ email: member.email, role: "supervisor" }).expect(200);
    const list = await as(co).get("/api/team").expect(200);
    expect(list.body.invitations).toHaveLength(1);
    expect(list.body.invitations[0].role).toBe("supervisor");
    await as(co).del(`/api/team/invitations/${list.body.invitations[0].id}`).expect(200);
    expect((await as(co).get("/api/team")).body.invitations).toHaveLength(0);
  });

  it("tautan email: orang yang belum terdaftar bisa bergabung setelah daftar dengan email yang sama", async () => {
    const co = await mk("perusahaan");
    const email = `baru-${randomUUID()}@example.test`;
    await as(co).post("/api/team/invite").send({ email, role: "hr" }).expect(200);
    const mail = sentEmails.find((m) => m.to.includes(email));
    expect(mail).toBeTruthy();
    const token = /join_team=([0-9a-f-]{36})/.exec(mail!.html ?? "")?.[1];
    expect(token).toBeTruthy();

    const id = `team-test-${randomUUID()}`;
    await db.insert(usersTable).values({ id, email, passwordHash: "x", name: "Baru Daftar", role: "pekerja" });
    const session = await createSession(id);
    cleanups.push(async () => {
      await deleteSession(session);
      await db.delete(companyTeamMembersTable).where(eq(companyTeamMembersTable.memberId, id));
      await db.delete(usersTable).where(eq(usersTable.id, id));
    });
    const joined = await request(app).post("/api/team/join").set("Cookie", `${SESSION_COOKIE}=${session}`).send({ token });
    expect(joined.status).toBe(200);
    expect(joined.body.role).toBe("hr");

    // Email lain tidak bisa memakai tautan itu.
    const other = await mk("pekerja");
    await as(other).post("/api/team/join").send({ token }).expect(404); // sudah terpakai
  });

  it("menolak: diri sendiri, peran finance, akun perusahaan, bukan pemilik, tanpa paket, anggota ganda", async () => {
    const co = await mk("perusahaan");
    const otherCo = await mk("perusahaan");
    const worker = await mk("pekerja");
    const noPlan = await mk("perusahaan", { plan: false });

    await as(co).post("/api/team/invite").send({ email: co.email, role: "hr" }).expect(400);
    await as(co).post("/api/team/invite").send({ email: worker.email, role: "finance" }).expect(400);
    await as(co).post("/api/team/invite").send({ email: otherCo.email, role: "hr" }).expect(400);
    await as(worker).post("/api/team/invite").send({ email: co.email, role: "hr" }).expect(403);
    await as(noPlan).post("/api/team/invite").send({ email: worker.email, role: "hr" }).expect(402);

    await join(co, worker, "hr");
    await as(co).post("/api/team/invite").send({ email: worker.email, role: "supervisor" }).expect(409);
  });

  it("tim dibatasi 10 anggota termasuk undangan tertunda", async () => {
    const co = await mk("perusahaan");
    for (let i = 0; i < 10; i += 1) {
      await as(co).post("/api/team/invite").send({ email: `slot${i}-${randomUUID()}@example.test`, role: "hr" }).expect(200);
    }
    const res = await as(co).post("/api/team/invite").send({ email: `slot-x-${randomUUID()}@example.test`, role: "hr" });
    expect(res.status).toBe(409);
  });
});

describe("kelola anggota", () => {
  it("ubah peran, keluarkan, dan anggota keluar sendiri", async () => {
    const co = await mk("perusahaan");
    const m1 = await mk("pekerja");
    const m2 = await mk("pekerja");
    await join(co, m1, "hr");
    await join(co, m2, "hr");

    await as(co).patch(`/api/team/${m1.id}`).send({ role: "supervisor" }).expect(200);
    expect((await as(m1).get("/api/team/my-membership")).body.membership.role).toBe("supervisor");
    await as(co).patch(`/api/team/${m1.id}`).send({ role: "finance" }).expect(400);
    await as(m1).patch(`/api/team/${m2.id}`).send({ role: "hr" }).expect(403);

    await as(co).del(`/api/team/${m1.id}`).expect(200);
    expect((await as(m1).get("/api/team/my-membership")).body.membership).toBeNull();
    await as(co).del(`/api/team/${m1.id}`).expect(404);

    await as(m2).del(`/api/team/membership/${co.id}`).expect(200);
    expect((await as(m2).get("/api/team/my-membership")).body.membership).toBeNull();
    await as(m2).del(`/api/team/membership/${co.id}`).expect(404);
  });

  it("anggota finance lama tidak punya akses dan tidak tampil", async () => {
    const co = await mk("perusahaan");
    const legacy = await mk("pekerja");
    await db.insert(companyTeamMembersTable).values({ companyId: co.id, memberId: legacy.id, role: "finance", acceptedAt: new Date() });
    expect((await as(legacy).get("/api/team/my-membership")).body.membership).toBeNull();
    expect((await as(co).get("/api/team")).body.members).toHaveLength(0);
  });
});

describe("hak akses per peran", () => {
  it("HR: lihat lamaran tanpa data sensitif dan boleh menerima/menolak; supervisor dan orang luar tidak", async () => {
    const co = await mk("perusahaan");
    const hr = await mk("pekerja");
    const sup = await mk("pekerja");
    const outsider = await mk("pekerja");
    const applicant = await mk("pekerja", { verified: true });
    await join(co, hr, "hr");
    await join(co, sup, "supervisor");
    const gigId = await fixtureGig(co);
    const appId = await fixtureApplication(gigId, co, applicant);

    const list = await as(hr).get(`/api/team/company/${co.id}/applications`).expect(200);
    expect(list.body).toHaveLength(1);
    const row = list.body[0];
    expect(row.workerName).toBe("Pelamar Uji");
    for (const secret of ["bank", "rekening", "workerNikMasked", "workerNpwpMasked", "workerId", "employerId"]) {
      expect(row).not.toHaveProperty(secret);
    }
    await as(sup).get(`/api/team/company/${co.id}/applications`).expect(404);
    await as(outsider).get(`/api/team/company/${co.id}/applications`).expect(404);

    await as(sup).patch(`/api/applications/${appId}/status`).send({ status: "diterima" }).expect(403);
    await as(outsider).patch(`/api/applications/${appId}/status`).send({ status: "diterima" }).expect(403);
    await as(hr).patch(`/api/applications/${appId}/status`).send({ status: "selesai" }).expect(403);
    await as(hr).patch(`/api/applications/${appId}/status`).send({ status: "ditinjau" }).expect(200);
    const accepted = await as(hr).patch(`/api/applications/${appId}/status`).send({ status: "diterima" });
    expect(accepted.status).toBe(200);
    expect(accepted.body.status).toBe("diterima");
    const [dbRow] = await db.select().from(applicationsTable).where(eq(applicationsTable.id, appId));
    expect(dbRow!.status).toBe("diterima");
  });

  it("HR tidak bisa memutuskan lamarannya sendiri, dan pemilik lain tidak bisa menyentuh lamaran perusahaan ini", async () => {
    const co = await mk("perusahaan");
    const rival = await mk("perusahaan");
    const hr = await mk("pekerja", { verified: true });
    await join(co, hr, "hr");
    const gigId = await fixtureGig(co);
    const ownApp = await fixtureApplication(gigId, co, hr);
    await as(hr).patch(`/api/applications/${ownApp}/status`).send({ status: "diterima" }).expect(403);
    await as(rival).patch(`/api/applications/${ownApp}/status`).send({ status: "ditolak" }).expect(404);
  });

  it("supervisor: lihat lowongan, pekerja yang diterima, dan presensi; HR tidak boleh lihat presensi", async () => {
    const co = await mk("perusahaan");
    const hr = await mk("pekerja");
    const sup = await mk("pekerja");
    const worker = await mk("pekerja", { verified: true });
    await join(co, hr, "hr");
    await join(co, sup, "supervisor");
    const gigId = await fixtureGig(co);
    await fixtureApplication(gigId, co, worker, "diterima");
    const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
    await db.insert(attendanceTable).values({ jobId: gigId, workerId: worker.id, workerName: "Pelamar Uji", kind: "masuk", scanDate: today });

    const gigs = await as(sup).get(`/api/team/company/${co.id}/gigs`).expect(200);
    expect(gigs.body.gigs[0].workers).toEqual([expect.objectContaining({ workerName: "Pelamar Uji", status: "diterima" })]);
    expect(JSON.stringify(gigs.body)).not.toMatch(/rekening|escrowAmount|nominal/i);

    const att = await as(sup).get(`/api/team/company/${co.id}/attendance`).expect(200);
    expect(att.body.records).toHaveLength(1);
    expect(att.body.records[0]).toMatchObject({ workerName: "Pelamar Uji", kind: "masuk" });
    await as(hr).get(`/api/team/company/${co.id}/attendance`).expect(404);
    await as(hr).get(`/api/team/company/${co.id}/gigs`).expect(200); // HR juga boleh lihat lowongan
  });

  it("akses berhenti saat dikeluarkan atau paket Bisnis perusahaan habis", async () => {
    const co = await mk("perusahaan");
    const hr = await mk("pekerja");
    await join(co, hr, "hr");
    await as(hr).get(`/api/team/company/${co.id}/applications`).expect(200);

    await db.update(usersTable).set({ expiredAt: new Date(Date.now() - 1000) }).where(eq(usersTable.id, co.id));
    await as(hr).get(`/api/team/company/${co.id}/applications`).expect(404);
    expect((await as(hr).get("/api/team/my-membership")).body.membership).toBeNull();

    await db.update(usersTable).set({ expiredAt: new Date(Date.now() + 86400_000) }).where(eq(usersTable.id, co.id));
    await as(hr).get(`/api/team/company/${co.id}/applications`).expect(200);
    await as(co).del(`/api/team/${hr.id}`).expect(200);
    await as(hr).get(`/api/team/company/${co.id}/applications`).expect(404);
  });

  it("tanpa login semua endpoint tim ditolak", async () => {
    await request(app).get("/api/team").expect(401);
    await request(app).get("/api/team/my-membership").expect(401);
    await request(app).get("/api/team/invitations/mine").expect(401);
    await request(app).get("/api/team/company/x/applications").expect(401);
    await request(app).get("/api/team/company/x/gigs").expect(401);
    await request(app).get("/api/team/company/x/attendance").expect(401);
  });
});
