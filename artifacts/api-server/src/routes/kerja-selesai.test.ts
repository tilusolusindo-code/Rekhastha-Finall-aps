import { afterAll, afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { eq, like } from "drizzle-orm";
import { applicationsTable, attendanceTable, db, ephemeralKvTable, gigsTable, pool, usersTable } from "@workspace/db";
import app from "../app.js";
import { createSession, deleteSession, SESSION_COOKIE } from "../lib/auth.js";
import { markWorkCompletedIfDone } from "../lib/work-completion.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const c of cleanups.splice(0).reverse()) await c(); });
afterAll(async () => { await pool.end(); });

const LAT = -6.2;
const LNG = 106.8;
const jakartaDate = (offsetDays = 0) => new Date(Date.now() + 7 * 3_600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);

async function makeUser(role: "perusahaan" | "pekerja", extra: Partial<typeof usersTable.$inferInsert> = {}) {
  const id = `ks-test-${randomUUID()}`;
  await db.insert(usersTable).values({
    id, email: `${id}@example.test`, passwordHash: "x", name: role === "pekerja" ? `Pekerja ${id.slice(-4)}` : "PT Uji", role, ...extra,
  });
  const token = await createSession(id);
  cleanups.push(async () => { await deleteSession(token); await db.delete(usersTable).where(eq(usersTable.id, id)); });
  return { id, name: `Pekerja ${id.slice(-4)}`, cookie: `${SESSION_COOKIE}=${token}` };
}

let nextId = 8_000_000 + Math.floor(Math.random() * 900_000);
async function setup(gigOver: Partial<typeof gigsTable.$inferInsert> = {}) {
  const employer = await makeUser("perusahaan", { isPremium: true, expiredAt: new Date(Date.now() + 30 * 86_400_000) });
  const worker = await makeUser("pekerja");
  const jobId = nextId++;
  await db.insert(gigsTable).values({
    id: jobId, posisi: "Kasir", pembayaran: "per_hari", nominal: 100_000, lat: LAT, lng: LNG, employerId: employer.id,
    paymentStatus: "confirmed", escrowStatus: "locked", jobDate: null, jumlahHari: 1, ...gigOver,
  });
  const [application] = await db.insert(applicationsTable).values({
    jobId, workerId: worker.id, workerName: worker.name, employerId: employer.id, status: "diterima",
  } as typeof applicationsTable.$inferInsert).returning();
  cleanups.push(async () => {
    await db.delete(attendanceTable).where(eq(attendanceTable.jobId, jobId));
    await db.delete(applicationsTable).where(eq(applicationsTable.jobId, jobId));
    await db.delete(gigsTable).where(eq(gigsTable.id, jobId));
    await db.delete(ephemeralKvTable).where(like(ephemeralKvTable.key, `attlatest:${employer.id}%`));
  });
  return { employer, worker, jobId, applicationId: application!.id };
}

const mint = (e: { cookie: string }, jobId: number, kind: "masuk" | "pulang") =>
  request(app).post("/api/attendance/token").set("Cookie", e.cookie).send({ jobId, kind });
const scan = (w: { cookie: string }, token: string) =>
  request(app).post("/api/attendance/scan").set("Cookie", w.cookie).send({ token, latitude: LAT, longitude: LNG, accuracy: 10 });
async function doScan(employer: { cookie: string }, worker: { cookie: string }, jobId: number, kind: "masuk" | "pulang") {
  const t = await mint(employer, jobId, kind);
  expect(t.status).toBe(201);
  return scan(worker, t.body.token);
}
const rowOf = async (id: number) => (await db.select().from(applicationsTable).where(eq(applicationsTable.id, id)))[0]!;

describe("pekerjaan selesai otomatis setelah scan pulang", () => {
  it("1 hari: scan masuk lalu pulang → ditandai selesai di server; status upah tetap diterima", async () => {
    const { employer, worker, jobId, applicationId } = await setup();
    const masuk = await doScan(employer, worker, jobId, "masuk");
    expect(masuk.status).toBe(201);
    expect(masuk.body.workCompleted).toBe(false);
    expect((await rowOf(applicationId)).workCompletedAt).toBeNull();

    const pulang = await doScan(employer, worker, jobId, "pulang");
    expect(pulang.status).toBe(201);
    expect(pulang.body.workCompleted).toBe(true);
    const row = await rowOf(applicationId);
    expect(row.workCompletedAt).not.toBeNull();
    expect(row.status).toBe("diterima"); // "selesai" tetap berarti upah disetujui (tombol pencairan tidak terblokir)

    // Tetap selesai keesokan harinya: server yang menyimpan, bukan hanya presensi "hari ini".
    const mine = await request(app).get("/api/applications/mine").set("Cookie", worker.cookie).expect(200);
    expect(mine.body.find((r: { id: number }) => r.id === applicationId).workCompletedAt).toBeTruthy();
  });

  it("pulang tanpa masuk tidak menyelesaikan pekerjaan", async () => {
    const { worker, jobId, applicationId } = await setup();
    await db.insert(attendanceTable).values({ jobId, workerId: worker.id, workerName: worker.name, kind: "pulang", scanDate: jakartaDate() });
    expect(await markWorkCompletedIfDone(jobId, worker.id)).toBe(false);
    expect((await rowOf(applicationId)).workCompletedAt).toBeNull();
  });

  it("3 hari: baru selesai setelah hari ke-3 lengkap", async () => {
    const { worker, jobId, applicationId } = await setup({ jumlahHari: 3 });
    const day = (d: number, kind: "masuk" | "pulang") =>
      db.insert(attendanceTable).values({ jobId, workerId: worker.id, workerName: worker.name, kind, scanDate: jakartaDate(d) });
    await day(-2, "masuk"); await day(-2, "pulang");
    await day(-1, "masuk"); await day(-1, "pulang");
    expect(await markWorkCompletedIfDone(jobId, worker.id)).toBe(false);
    await day(0, "masuk"); await day(0, "pulang");
    expect(await markWorkCompletedIfDone(jobId, worker.id)).toBe(true);
    expect((await rowOf(applicationId)).workCompletedAt).not.toBeNull();
  });

  it("hari ke-2 dari 3 hari yang hanya masuk (belum pulang) tidak dihitung", async () => {
    const { worker, jobId } = await setup({ jumlahHari: 2 });
    const add = (d: number, kind: "masuk" | "pulang") =>
      db.insert(attendanceTable).values({ jobId, workerId: worker.id, workerName: worker.name, kind, scanDate: jakartaDate(d) });
    await add(-1, "masuk"); await add(-1, "pulang"); await add(0, "masuk");
    expect(await markWorkCompletedIfDone(jobId, worker.id)).toBe(false);
  });

  it("penyembuhan: lamaran lama yang sudah lengkap presensinya ditandai saat riwayat dimuat", async () => {
    const { worker, jobId, applicationId } = await setup();
    const add = (kind: "masuk" | "pulang") =>
      db.insert(attendanceTable).values({ jobId, workerId: worker.id, workerName: worker.name, kind, scanDate: jakartaDate(-3) });
    await add("masuk"); await add("pulang"); // scan 3 hari lalu, tidak pernah ditandai
    expect((await rowOf(applicationId)).workCompletedAt).toBeNull();
    const mine = await request(app).get("/api/applications/mine").set("Cookie", worker.cookie).expect(200);
    expect(mine.body.find((r: { id: number }) => r.id === applicationId).workCompletedAt).toBeTruthy();
    expect((await rowOf(applicationId)).workCompletedAt).not.toBeNull();
  });

  it("idempoten dan tidak menyentuh lamaran yang bukan diterima", async () => {
    const { worker, jobId, applicationId } = await setup();
    await db.insert(attendanceTable).values([
      { jobId, workerId: worker.id, workerName: worker.name, kind: "masuk", scanDate: jakartaDate() },
      { jobId, workerId: worker.id, workerName: worker.name, kind: "pulang", scanDate: jakartaDate() },
    ]);
    await db.update(applicationsTable).set({ status: "ditolak" }).where(eq(applicationsTable.id, applicationId));
    await markWorkCompletedIfDone(jobId, worker.id);
    expect((await rowOf(applicationId)).workCompletedAt).toBeNull();

    await db.update(applicationsTable).set({ status: "diterima" }).where(eq(applicationsTable.id, applicationId));
    await markWorkCompletedIfDone(jobId, worker.id);
    const first = (await rowOf(applicationId)).workCompletedAt!;
    await markWorkCompletedIfDone(jobId, worker.id);
    expect((await rowOf(applicationId)).workCompletedAt!.getTime()).toBe(first.getTime());
  });
});
