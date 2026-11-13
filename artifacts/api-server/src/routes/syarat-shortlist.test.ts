import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { and, eq, or, sql } from "drizzle-orm";
import {
  applicationUploadsTable, applicationsTable, clientShareLinksTable, companyTeamMembersTable, db, gigsTable,
  notificationsTable, pool, usersTable,
} from "@workspace/db";

// Penyimpanan berkas dipalsukan: unggahan "selesai" dengan tanda tangan PNG yang sah.
vi.mock("../lib/private-application-storage", () => ({
  createPrivateUploadTarget: async () => ({ uploadUrl: "https://storage.test/put", objectPath: `/objects/uploads/test-${Math.random().toString(36).slice(2)}` }),
  verifyPrivateObjectExists: async () => true,
  readPrivateObjectHead: async () => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]),
  createPrivateDownloadUrl: async () => "https://storage.test/get",
  deletePrivateObject: async () => undefined,
}));

import app from "../app.js";
import { createSession, deleteSession, SESSION_COOKIE } from "../lib/auth.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const c of cleanups.splice(0).reverse()) await c(); });
afterAll(async () => { await pool.end(); });

type Acc = { id: string; email: string; cookie: string };
const PROFILE = {
  namaLengkap: "Budi Santoso", nik: "3171000000000001", tempatLahir: "Jakarta", tanggalLahir: "1995-01-01", jenisKelamin: "L",
  whatsapp: "081234567890", belumPunyaNpwp: true, namaBank: "BCA", nomorRekening: "1234567890", namaRekening: "Budi Santoso",
  ktpUploaded: true, selfieUploaded: true,
};

async function mk(role: "pekerja" | "perusahaan", name = "Budi Santoso"): Promise<Acc> {
  const id = `ss-test-${randomUUID()}`;
  await db.insert(usersTable).values({
    id, email: `${id}@example.test`, passwordHash: "x", name, role,
    profile: role === "pekerja" ? { ...PROFILE, namaLengkap: name } : { namaPerusahaan: "PT Riset Uji" },
    expiredAt: role === "perusahaan" ? new Date(Date.now() + 30 * 86400_000) : null,
    isPremium: role === "perusahaan",
    verificationStatus: "verified",
  });
  const token = await createSession(id);
  cleanups.push(async () => {
    await deleteSession(token);
    await db.delete(notificationsTable).where(eq(notificationsTable.userId, id));
    await db.delete(companyTeamMembersTable).where(or(eq(companyTeamMembersTable.companyId, id), eq(companyTeamMembersTable.memberId, id)));
    await db.delete(clientShareLinksTable).where(eq(clientShareLinksTable.companyId, id));
    await db.delete(usersTable).where(eq(usersTable.id, id));
  });
  return { id, email: `${id}@example.test`, cookie: `${SESSION_COOKIE}=${token}` };
}
const ipOf = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const as = (a: Acc) => {
  const ip = ipOf();
  const h = (r: request.Test) => r.set("Cookie", a.cookie).set("X-Forwarded-For", ip);
  return {
    get: (p: string) => h(request(app).get(p)), post: (p: string) => h(request(app).post(p)),
    del: (p: string) => h(request(app).delete(p)),
  };
};
const anon = () => {
  const ip = ipOf();
  return {
    get: (p: string) => request(app).get(p).set("X-Forwarded-For", ip),
    post: (p: string) => request(app).post(p).set("X-Forwarded-For", ip),
  };
};

type Q = { id: string; prompt: string; required: boolean; answerType: "short" | "long" | "yes_no" | "photo" | "file" };
async function mkGig(company: Acc, questions: Q[]) {
  const id = Number.parseInt(randomUUID().replace(/-/g, "").slice(0, 12), 16) + 1;
  await db.insert(gigsTable).values({
    id, posisi: "Surveyor uji", pembayaran: "per_hari", nominal: 100_000, lat: -6.2, lng: 106.8, employerId: company.id,
    paymentStatus: "confirmed", escrowStatus: "locked", escrowAmount: 100_000, kuota: 3, jumlahHari: 1, hiringMode: "lama",
    applicationQuestions: questions,
  });
  cleanups.push(async () => {
    await db.delete(applicationUploadsTable).where(eq(applicationUploadsTable.jobId, id));
    await db.delete(applicationsTable).where(eq(applicationsTable.jobId, id));
    await db.delete(gigsTable).where(eq(gigsTable.id, id));
  });
  return id;
}

/** Unggah satu berkas untuk sebuah syarat lewat alur request-url → complete. */
async function uploadFor(worker: Acc, jobId: number, questionId: string | undefined, kind: "photo" | "file", contentType = "image/png") {
  const w = as(worker);
  const reqRes = await w.post("/api/applications/uploads/request-url").send({ jobId, fileName: "x.png", fileSize: 1000, contentType, kind, questionId });
  if (reqRes.status !== 201) return { status: reqRes.status, body: reqRes.body } as const;
  const done = await w.post(`/api/applications/uploads/${reqRes.body.id}/complete`);
  return { status: done.status, id: reqRes.body.id as number, body: done.body } as const;
}

describe("syarat foto/file pada pertanyaan tambahan", () => {
  const questions: Q[] = [
    { id: "q-ktp", prompt: "Foto KTP", required: true, answerType: "photo" },
    { id: "q-cv", prompt: "Surat lamaran (PDF)", required: false, answerType: "file" },
    { id: "q-txt", prompt: "Pengalaman survei?", required: true, answerType: "short" },
  ];

  it("pemberi kerja boleh membuat syarat foto/file, tapi maksimal 4 dan ID unik", async () => {
    const co = await mk("perusahaan");
    const body = (qs: Q[]) => ({
      posisi: "Surveyor", deskripsi: "Survei lapangan harian", pembayaran: "per_hari", nominal: 100_000, kuota: 1,
      lat: -6.2, lng: 106.8, hiringMode: "lama", applicationQuestions: qs,
    });
    const tooMany: Q[] = Array.from({ length: 5 }, (_, i) => ({ id: `u${i}`, prompt: `Berkas ${i}`, required: true, answerType: "file" as const }));
    const r = await as(co).post("/api/gigs").send(body(tooMany));
    expect(r.status).toBe(400);
    const dup = await as(co).post("/api/gigs").send(body([
      { id: "a", prompt: "Foto A", required: true, answerType: "photo" }, { id: "a", prompt: "Foto B", required: true, answerType: "photo" },
    ]));
    expect(dup.status).toBe(400);
  });

  it("pelamar tidak bisa melamar tanpa syarat wajib; berhasil setelah foto diunggah ke syarat yang benar", async () => {
    const co = await mk("perusahaan");
    const worker = await mk("pekerja");
    const jobId = await mkGig(co, questions);
    const apply = (uploadIds: number[], answers: Record<string, string> = { "q-txt": "Ya, 2 tahun" }) =>
      as(worker).post("/api/applications").send({ jobId, jobTitle: "x", workerName: "Budi Santoso", applicationAnswers: answers, uploadIds });

    expect((await apply([])).status).toBe(400); // foto wajib belum ada

    // Berkas generik (tanpa questionId) tidak memenuhi syarat "Foto KTP".
    const generic = await uploadFor(worker, jobId, undefined, "photo");
    expect(generic.status).toBe(200);
    expect((await apply([generic.id!])).status).toBe(400);

    // Jenis berkas salah untuk syarat itu ditolak sejak awal.
    const wrongKind = await uploadFor(worker, jobId, "q-ktp", "file", "application/pdf");
    expect(wrongKind.status).toBe(400);
    // Syarat yang tidak ada ditolak.
    expect((await uploadFor(worker, jobId, "q-hantu", "photo")).status).toBe(400);
    // Pertanyaan teks tidak bisa dijawab dengan unggahan.
    expect((await uploadFor(worker, jobId, "q-txt", "photo")).status).toBe(400);

    const ktp = await uploadFor(worker, jobId, "q-ktp", "photo");
    expect(ktp.status).toBe(200);
    const ok = await apply([ktp.id!]);
    expect(ok.status).toBe(201);
    expect(ok.body.uploadedFiles).toEqual(expect.arrayContaining([expect.objectContaining({ id: ktp.id, questionId: "q-ktp" })]));
  });

  it("jawaban teks untuk syarat unggahan ditolak, dan pertanyaan teks wajib tetap dicek", async () => {
    const co = await mk("perusahaan");
    const worker = await mk("pekerja");
    const jobId = await mkGig(co, questions);
    const ktp = await uploadFor(worker, jobId, "q-ktp", "photo");
    const send = (answers: Record<string, string>) =>
      as(worker).post("/api/applications").send({ jobId, jobTitle: "x", workerName: "Budi", applicationAnswers: answers, uploadIds: [ktp.id] });
    expect((await send({ "q-txt": "ok", "q-ktp": "http://evil" })).status).toBe(400);
    expect((await send({})).status).toBe(400); // pertanyaan teks wajib kosong
    expect((await send({ "q-txt": "ok" })).status).toBe(201);
  });

  it("klien melihat daftar pertanyaan & status lampiran, tetapi tidak berkasnya", async () => {
    const co = await mk("perusahaan");
    const worker = await mk("pekerja");
    const jobId = await mkGig(co, questions);
    const ktp = await uploadFor(worker, jobId, "q-ktp", "photo");
    const app = await as(worker).post("/api/applications").send({ jobId, jobTitle: "x", workerName: "Budi", applicationAnswers: { "q-txt": "siap" }, uploadIds: [ktp.id] });
    expect(app.status).toBe(201);
    await as(co).post(`/api/applications/${app.body.id}/shortlist`).send({ shortlisted: true }).expect(200);
    const link = await as(co).post("/api/client-links").send({ jobId, label: "K", days: 2 });
    const view = await anon().get(`/api/public/client-view/${link.body.url.split("klien=")[1]}`).expect(200);
    expect(view.body.questions.map((q: { type: string }) => q.type)).toEqual(questions.map((q) => q.answerType));
    const ans = view.body.candidates[0].answers as Array<{ type: string; attached: boolean; answer: string }>;
    const photo = ans.find((a) => a.type === "photo")!;
    expect(photo.attached).toBe(true);
    expect(photo.answer).toBe("");
    const dump = JSON.stringify(view.body);
    expect(dump).not.toContain("/api/applications/files");
    expect(dump).not.toContain("fileName");
  });

  it("syarat opsional boleh dilewati", async () => {
    const co = await mk("perusahaan");
    const worker = await mk("pekerja");
    const jobId = await mkGig(co, [{ id: "q-opt", prompt: "Foto portofolio", required: false, answerType: "photo" }]);
    const res = await as(worker).post("/api/applications").send({ jobId, jobTitle: "x", workerName: "Budi", uploadIds: [] });
    expect(res.status).toBe(201);
  });
});

describe("shortlist untuk klien agensi", () => {
  async function setup() {
    const co = await mk("perusahaan");
    const w1 = await mk("pekerja", "Budi Santoso");
    const w2 = await mk("pekerja", "Siti Rahma");
    const jobId = await mkGig(co, [{ id: "q1", prompt: "Pengalaman?", required: true, answerType: "short" }]);
    const apply = async (w: Acc, answer: string) => {
      const r = await as(w).post("/api/applications").send({
        jobId, jobTitle: "x", workerName: "ignored", bank: "BCA", rekening: "9999888877", workerNikMasked: "3171********0001",
        applicationAnswers: { q1: answer }, supportingInfo: { experience: `Pengalaman ${answer}` },
      });
      expect(r.status).toBe(201);
      return r.body.id as number;
    };
    const a1 = await apply(w1, "tiga tahun");
    const a2 = await apply(w2, "lima tahun");
    return { co, w1, w2, jobId, a1, a2 };
  }
  const tokenOf = (url: string) => url.split("klien=")[1]!;

  it("alur lengkap: shortlist → tautan → klien menilai → agensi melihat penilaian", async () => {
    const { co, jobId, a1, a2 } = await setup();
    await as(co).post(`/api/applications/${a1}/shortlist`).send({ shortlisted: true }).expect(200);

    const link = await as(co).post("/api/client-links").send({ jobId, label: "Klien PT Maju", days: 3 });
    expect(link.status).toBe(201);
    const token = tokenOf(link.body.url);
    // Hanya hash yang tersimpan.
    const [row] = await db.select().from(clientShareLinksTable).where(eq(clientShareLinksTable.id, link.body.id));
    expect(row!.tokenHash).not.toContain(token);
    expect(row!.tokenHash).toHaveLength(64);

    const view = await anon().get(`/api/public/client-view/${token}`);
    expect(view.status).toBe(200);
    expect(view.headers["x-robots-tag"]).toContain("noindex");
    expect(view.body.candidates).toHaveLength(1); // a2 belum shortlist
    const c = view.body.candidates[0];
    expect(c.displayName).toBe("Budi S.");
    expect(view.body.questions).toEqual([{ prompt: "Pengalaman?", type: "short", required: true }]);
    expect(c.answers).toEqual([{ prompt: "Pengalaman?", type: "short", required: true, answer: "tiga tahun", attached: false }]);
    // Tidak ada data sensitif/identitas penuh.
    const dump = JSON.stringify(view.body);
    for (const secret of ["9999888877", "3171", "Santoso", "BCA", "rekening", "workerId", "employerId", "uploadedFiles"]) {
      expect(dump).not.toContain(secret);
    }

    const rate = await anon().post(`/api/public/client-view/${token}/decision`).send({ applicationId: c.id, decision: "setuju", note: "Cocok untuk proyek kami" });
    expect(rate.status).toBe(200);
    // Pelamar yang tidak di-shortlist tidak bisa dinilai lewat tautan ini.
    expect((await anon().post(`/api/public/client-view/${token}/decision`).send({ applicationId: a2, decision: "setuju" })).status).toBe(404);

    const list = await as(co).get(`/api/applications?jobId=${jobId}`).expect(200);
    const mine = list.body.find((x: { id: number }) => x.id === a1);
    expect(mine).toMatchObject({ clientDecision: "setuju", clientNote: "Cocok untuk proyek kami" });
    expect(mine.status).toBe("baru"); // klien tidak mengubah status lamaran
    const notif = await db.select().from(notificationsTable).where(and(eq(notificationsTable.userId, co.id), eq(notificationsTable.applicationId, a1)));
    expect(notif.some((n) => n.message.includes("Klien menilai Budi S."))).toBe(true);
  });

  it("tautan dicabut atau kedaluwarsa tidak berlaku; token ngawur ditolak", async () => {
    const { co, jobId, a1 } = await setup();
    await as(co).post(`/api/applications/${a1}/shortlist`).send({ shortlisted: true }).expect(200);
    const link = await as(co).post("/api/client-links").send({ jobId });
    const token = tokenOf(link.body.url);
    await anon().get(`/api/public/client-view/${token}`).expect(200);

    const listed = await as(co).get(`/api/client-links?jobId=${jobId}`).expect(200);
    expect(JSON.stringify(listed.body)).not.toContain(token);
    await as(co).del(`/api/client-links/${link.body.id}`).expect(200);
    await anon().get(`/api/public/client-view/${token}`).expect(404);
    await anon().post(`/api/public/client-view/${token}/decision`).send({ applicationId: a1, decision: "tidak" }).expect(404);

    const link2 = await as(co).post("/api/client-links").send({ jobId });
    await db.update(clientShareLinksTable).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(clientShareLinksTable.id, link2.body.id));
    await anon().get(`/api/public/client-view/${tokenOf(link2.body.url)}`).expect(404);
    await anon().get("/api/public/client-view/tidak-ada-token-ini-sama-sekali").expect(404);
    await anon().get("/api/public/client-view/short").expect(404);
  });

  it("hanya pemilik atau HR yang boleh mengelola; supervisor, pekerja, dan pemilik lain tidak", async () => {
    const { co, jobId, a1 } = await setup();
    const rival = await mk("perusahaan");
    const hr = await mk("pekerja");
    const sup = await mk("pekerja");
    const now = new Date();
    await db.insert(companyTeamMembersTable).values([
      { companyId: co.id, memberId: hr.id, role: "hr", acceptedAt: now },
      { companyId: co.id, memberId: sup.id, role: "supervisor", acceptedAt: now },
    ]);

    await as(rival).post(`/api/applications/${a1}/shortlist`).send({ shortlisted: true }).expect(404);
    await as(sup).post(`/api/applications/${a1}/shortlist`).send({ shortlisted: true }).expect(404);
    await as(sup).post("/api/client-links").send({ jobId }).expect(404);
    await as(rival).post("/api/client-links").send({ jobId }).expect(404);
    await anon().post(`/api/applications/${a1}/shortlist`).send({ shortlisted: true }).expect(401);

    await as(hr).post(`/api/applications/${a1}/shortlist`).send({ shortlisted: true }).expect(200);
    const link = await as(hr).post("/api/client-links").send({ jobId });
    expect(link.status).toBe(201);
    await as(sup).del(`/api/client-links/${link.body.id}`).expect(404);
    await as(hr).del(`/api/client-links/${link.body.id}`).expect(200);

    // HR melihat penilaian klien di ruang kerjanya.
    const l2 = await as(co).post("/api/client-links").send({ jobId });
    await anon().post(`/api/public/client-view/${tokenOf(l2.body.url)}/decision`).send({ applicationId: a1, decision: "tidak", note: "kurang cocok" }).expect(200);
    const hrView = await as(hr).get(`/api/team/company/${co.id}/applications`).expect(200);
    expect(hrView.body.find((x: { id: number }) => x.id === a1)).toMatchObject({ clientDecision: "tidak", clientNote: "kurang cocok" });
  });

  it("mencabut shortlist menghapus penilaian; pelamar ditolak hilang dari tampilan klien; batas tautan aktif", async () => {
    const { co, jobId, a1 } = await setup();
    await as(co).post(`/api/applications/${a1}/shortlist`).send({ shortlisted: true }).expect(200);
    const link = await as(co).post("/api/client-links").send({ jobId });
    const token = tokenOf(link.body.url);
    await anon().post(`/api/public/client-view/${token}/decision`).send({ applicationId: a1, decision: "setuju" }).expect(200);

    await as(co).post(`/api/applications/${a1}/shortlist`).send({ shortlisted: false }).expect(200);
    expect((await anon().get(`/api/public/client-view/${token}`)).body.candidates).toHaveLength(0);
    await as(co).post(`/api/applications/${a1}/shortlist`).send({ shortlisted: true }).expect(200);
    expect((await anon().get(`/api/public/client-view/${token}`)).body.candidates[0].decision).toBeNull();

    await db.update(applicationsTable).set({ status: "ditolak" }).where(eq(applicationsTable.id, a1));
    expect((await anon().get(`/api/public/client-view/${token}`)).body.candidates).toHaveLength(0);
    await as(co).post(`/api/applications/${a1}/shortlist`).send({ shortlisted: true }).expect(409);

    for (let i = 0; i < 4; i += 1) await as(co).post("/api/client-links").send({ jobId }).expect(201);
    await as(co).post("/api/client-links").send({ jobId }).expect(409); // sudah 5 aktif
  });
});
