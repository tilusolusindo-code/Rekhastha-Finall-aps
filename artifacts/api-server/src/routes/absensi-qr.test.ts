import { afterAll, afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { eq, like } from "drizzle-orm";
import {
  applicationsTable,
  attendanceTable,
  db,
  ephemeralKvTable,
  gigsTable,
  pool,
  usersTable,
} from "@workspace/db";
import app from "../app.js";
import { createSession, deleteSession, SESSION_COOKIE } from "../lib/auth.js";
import { kvGet } from "../lib/ephemeral.js";
import { checkAttendanceWindow, parseShift } from "../lib/attendance-window.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});
afterAll(async () => {
  await pool.end();
});

const LAT = -6.2;
const LNG = 106.8;

async function makeUser(role: "perusahaan" | "pekerja", extra: Partial<typeof usersTable.$inferInsert> = {}) {
  const id = `qr-test-${randomUUID()}`;
  await db.insert(usersTable).values({
    id, email: `${id}@example.test`, passwordHash: "x", name: role === "pekerja" ? `Pekerja ${id.slice(-4)}` : "PT Uji", role, ...extra,
  });
  const token = await createSession(id);
  cleanups.push(async () => {
    await deleteSession(token);
    await db.delete(usersTable).where(eq(usersTable.id, id));
  });
  return { id, name: `Pekerja ${id.slice(-4)}`, cookie: `${SESSION_COOKIE}=${token}` };
}

let nextId = 9_000_000 + Math.floor(Math.random() * 900_000);
async function setup(gigOver: Partial<typeof gigsTable.$inferInsert> = {}) {
  const employer = await makeUser("perusahaan", { isPremium: true, expiredAt: new Date(Date.now() + 30 * 86_400_000) });
  const jobId = nextId++;
  await db.insert(gigsTable).values({
    id: jobId, posisi: "Kasir", pembayaran: "per_hari", nominal: 100_000, lat: LAT, lng: LNG,
    employerId: employer.id, paymentStatus: "confirmed", escrowStatus: "locked", ...gigOver,
  });
  cleanups.push(async () => {
    await db.delete(attendanceTable).where(eq(attendanceTable.jobId, jobId));
    await db.delete(applicationsTable).where(eq(applicationsTable.jobId, jobId));
    await db.delete(gigsTable).where(eq(gigsTable.id, jobId));
    await db.delete(ephemeralKvTable).where(like(ephemeralKvTable.key, `attlatest:${employer.id}%`));
  });
  const accept = async (worker: { id: string; name: string }) => {
    await db.insert(applicationsTable).values({
      jobId, workerId: worker.id, workerName: worker.name, employerId: employer.id, status: "diterima",
    } as typeof applicationsTable.$inferInsert);
  };
  return { employer, jobId, accept };
}

const mint = (e: { cookie: string }, jobId: number, extra: object = {}) =>
  request(app).post("/api/attendance/token").set("Cookie", e.cookie).send({ jobId, kind: "masuk", ...extra });
const scan = (w: { cookie: string }, token: string) =>
  request(app).post("/api/attendance/scan").set("Cookie", w.cookie).send({ token, latitude: LAT, longitude: LNG, accuracy: 10 });

// ── jendela waktu (fungsi murni) ─────────────────────────────────────────────
describe("jendela waktu presensi", () => {
  // 2026-11-12 (Kamis) jam 09:00 WIB = 02:00 UTC
  const at = (hhmm: string, date = "2026-11-12") => new Date(`${date}T${hhmm}:00+07:00`);
  const jobDate = new Date("2026-11-12T00:00:00+07:00");
  const base = { jobDate, jumlahHari: 1, jamKerja: "08:00 - 17:00 WIB" };

  it("membaca berbagai format jam kerja", () => {
    expect(parseShift("08:00 - 17:00 WIB")).toEqual({ startMin: 480, endMin: 1020 });
    expect(parseShift("8.30 s/d 16.00")).toEqual({ startMin: 510, endMin: 960 });
    expect(parseShift("22:00 – 06:00")).toEqual({ startMin: 1320, endMin: 1800 });
    expect(parseShift("fleksibel")).toBeNull();
    expect(parseShift(null)).toBeNull();
  });

  it("masuk: boleh 60 menit sebelum mulai sampai jam selesai", () => {
    expect(checkAttendanceWindow({ kind: "masuk", now: at("06:59"), ...base }).ok).toBe(false);
    expect(checkAttendanceWindow({ kind: "masuk", now: at("07:00"), ...base }).ok).toBe(true);
    expect(checkAttendanceWindow({ kind: "masuk", now: at("12:00"), ...base }).ok).toBe(true);
    expect(checkAttendanceWindow({ kind: "masuk", now: at("17:01"), ...base }).ok).toBe(false);
  });

  it("pulang: dari jam mulai sampai 120 menit setelah selesai", () => {
    expect(checkAttendanceWindow({ kind: "pulang", now: at("07:59"), ...base }).ok).toBe(false);
    expect(checkAttendanceWindow({ kind: "pulang", now: at("17:00"), ...base }).ok).toBe(true);
    expect(checkAttendanceWindow({ kind: "pulang", now: at("19:00"), ...base }).ok).toBe(true);
    expect(checkAttendanceWindow({ kind: "pulang", now: at("19:01"), ...base }).ok).toBe(false);
  });

  it("pesan error jelas untuk terlalu awal dan sudah ditutup", () => {
    const early = checkAttendanceWindow({ kind: "masuk", now: at("05:00"), ...base });
    expect(early.ok === false && early.error).toMatch(/dibuka pukul 07:00/);
    const late = checkAttendanceWindow({ kind: "masuk", now: at("20:00"), ...base });
    expect(late.ok === false && late.error).toMatch(/ditutup/);
  });

  it("tanggal: di luar rentang hari kerja ditolak; jumlah hari > 1 dihitung", () => {
    expect(checkAttendanceWindow({ kind: "masuk", now: at("09:00", "2026-11-11"), ...base }).ok).toBe(false);
    expect(checkAttendanceWindow({ kind: "masuk", now: at("09:00", "2026-11-13"), ...base }).ok).toBe(false);
    const three = { ...base, jumlahHari: 3 };
    expect(checkAttendanceWindow({ kind: "masuk", now: at("09:00", "2026-11-14"), ...three }).ok).toBe(true);
    expect(checkAttendanceWindow({ kind: "masuk", now: at("09:00", "2026-11-15"), ...three }).ok).toBe(false);
  });

  it("shift lintas tengah malam: pulang jam 05:00 keesokan hari sah", () => {
    const night = { jobDate, jumlahHari: 1, jamKerja: "22:00 - 06:00" };
    expect(checkAttendanceWindow({ kind: "masuk", now: at("22:30"), ...night }).ok).toBe(true);
    expect(checkAttendanceWindow({ kind: "pulang", now: at("05:00", "2026-11-13"), ...night }).ok).toBe(true);
  });

  it("tanpa tanggal kerja tidak dibatasi; jam tak terbaca hanya memeriksa tanggal", () => {
    expect(checkAttendanceWindow({ kind: "masuk", now: at("03:00"), jobDate: null, jumlahHari: null, jamKerja: "08:00 - 17:00" }).ok).toBe(true);
    expect(checkAttendanceWindow({ kind: "masuk", now: at("03:00"), jobDate, jumlahHari: 1, jamKerja: "fleksibel" }).ok).toBe(true);
    expect(checkAttendanceWindow({ kind: "masuk", now: at("03:00", "2026-11-20"), jobDate, jumlahHari: 1, jamKerja: "fleksibel" }).ok).toBe(false);
  });
});

// ── QR berputar ──────────────────────────────────────────────────────────────
describe("QR berputar", () => {
  it("token berlaku ~30 detik (bukan 3 menit) dan token lama dipersingkat saat token baru dibuat", async () => {
    const { employer, jobId } = await setup({ jobDate: null });
    const first = await mint(employer, jobId);
    expect(first.status).toBe(201);
    expect(first.body.ttlMs).toBe(30_000);
    expect(first.body.expiresAt - Date.now()).toBeLessThanOrEqual(30_000);

    const second = await mint(employer, jobId);
    expect(second.body.token).not.toBe(first.body.token);

    const rows = await db.select().from(ephemeralKvTable).where(like(ephemeralKvTable.key, "att:%"));
    const old = rows.find((r) => r.key === `att:${first.body.token}`)!;
    const fresh = rows.find((r) => r.key === `att:${second.body.token}`)!;
    expect(old.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(8_500); // tenggang singkat
    expect(fresh.expiresAt.getTime() - Date.now()).toBeGreaterThan(20_000);
  });

  it("token yang sudah dipakai tidak bisa dipakai lagi (tangkapan layar tak berguna)", async () => {
    const { employer, jobId, accept } = await setup({ jobDate: null });
    const w1 = await makeUser("pekerja");
    const w2 = await makeUser("pekerja");
    await accept(w1); await accept(w2);
    const t = (await mint(employer, jobId)).body.token;
    expect((await scan(w1, t)).status).toBe(201);
    const replay = await scan(w2, t);
    expect(replay.status).toBe(410);
  });
});

// ── QR khusus pekerja ────────────────────────────────────────────────────────
describe("QR khusus satu pekerja", () => {
  it("pekerja lain ditolak tanpa menghanguskan token; pekerja yang berhak tetap bisa", async () => {
    const { employer, jobId, accept } = await setup({ jobDate: null });
    const budi = await makeUser("pekerja");
    const joki = await makeUser("pekerja");
    await accept(budi); await accept(joki);

    const t = (await mint(employer, jobId, { workerId: budi.id })).body.token;
    const stolen = await scan(joki, t);
    expect(stolen.status).toBe(403);
    expect(stolen.body.error).toMatch(/khusus untuk pekerja lain/);
    expect(await db.select().from(attendanceTable).where(eq(attendanceTable.workerId, joki.id))).toHaveLength(0);
    expect(await kvGet(`att:${t}`)).not.toBeNull(); // token masih ada

    const ok = await scan(budi, t);
    expect(ok.status).toBe(201);
    expect(ok.body.workerName).toBe(budi.name);
  });

  it("tidak bisa membuat QR untuk pekerja yang lamarannya belum diterima / bukan miliknya", async () => {
    const { employer, jobId } = await setup({ jobDate: null });
    const stranger = await makeUser("pekerja");
    const r = await mint(employer, jobId, { workerId: stranger.id });
    expect(r.status).toBe(404);
  });
});

// ── jendela waktu di endpoint scan ───────────────────────────────────────────
describe("scan di luar jam kerja", () => {
  it("ditolak dengan pesan jelas dan token tidak hangus", async () => {
    // Jam kerja jauh di masa lalu (kemarin) -> pasti di luar jendela.
    const yesterday = new Date(Date.now() - 2 * 86_400_000);
    const { employer, jobId, accept } = await setup({ jobDate: yesterday, jumlahHari: 1, jamKerja: "08:00 - 17:00 WIB" });
    const w = await makeUser("pekerja");
    await accept(w);
    const t = (await mint(employer, jobId)).body.token;
    const r = await scan(w, t);
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/Presensi|presensi/);
    expect(await kvGet(`att:${t}`)).not.toBeNull();
    expect(await db.select().from(attendanceTable).where(eq(attendanceTable.workerId, w.id))).toHaveLength(0);
  });
});
