import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { applicationsTable, db, gigsTable, pool, usersTable } from "@workspace/db";
import app from "../app.js";
import { sendShiftReminders } from "../lib/shift-reminders.js";

const cleanups: Array<() => Promise<void>> = [];
const sent: Array<{ to: string[]; subject: string; text?: string }> = [];

// 10 Juni 2026 17:00 WIB -> besok (WIB) = 11 Juni 2026.
const NOW = new Date("2026-06-10T10:00:00Z");
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

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
  delete process.env["CRON_SECRET"];
  for (const c of cleanups.splice(0).reverse()) await c();
});
afterAll(async () => {
  await pool.end();
});

async function setup() {
  const employer = `ps-e-${randomUUID()}`;
  const gigIds: number[] = [];
  const workerIds: string[] = [];
  await db.insert(usersTable).values({ id: employer, email: `${employer}@example.test`, passwordHash: "x", name: "PT Uji", role: "perusahaan" });
  cleanups.push(async () => {
    if (gigIds.length) await db.delete(applicationsTable).where(inArray(applicationsTable.jobId, gigIds));
    if (gigIds.length) await db.delete(gigsTable).where(inArray(gigsTable.id, gigIds));
    if (workerIds.length) await db.delete(usersTable).where(inArray(usersTable.id, workerIds));
    await db.delete(usersTable).where(eq(usersTable.id, employer));
  });
  async function worker(extra: Partial<typeof usersTable.$inferInsert> = {}) {
    const id = `ps-w-${randomUUID()}`;
    workerIds.push(id);
    await db.insert(usersTable).values({ id, email: `${id}@example.test`, passwordHash: "x", name: "Budi Uji", role: "pekerja", ...extra });
    return { id, email: `${id}@example.test` };
  }
  async function gig(jobDate: Date | null, jumlahHari = 1, escrowStatus = "locked") {
    const id = Number.parseInt(randomUUID().replace(/-/g, "").slice(0, 12), 16) + 1;
    gigIds.push(id);
    await db.insert(gigsTable).values({
      id, posisi: "Barista uji", pembayaran: "per_hari", nominal: 100_000, lat: -6.2, lng: 106.8, employerId: employer,
      paymentStatus: "confirmed", escrowStatus, escrowAmount: 100_000, jumlahHari, jobDate,
      jamKerja: "08:00 - 17:00 WIB", alamat: "Jl. Uji No. 1, Jakarta",
    });
    return id;
  }
  async function apply(jobId: number, workerId: string, status = "diterima") {
    await db.insert(applicationsTable).values({ jobId, workerId, employerId: employer, status, workerName: "Budi Uji", jobTitle: "Barista uji" });
  }
  return { worker, gig, apply };
}

describe("pengingat shift H-1", () => {
  it("mengirim satu email ke pekerja yang diterima dan bekerja besok, memuat jam dan lokasi", async () => {
    const t = await setup();
    const w = await t.worker();
    const g = await t.gig(day("2026-06-11"));
    await t.apply(g, w.id);

    expect(await sendShiftReminders(NOW)).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toEqual([w.email]);
    expect(sent[0]!.subject).toContain("Barista uji");
    expect(sent[0]!.text).toContain("08:00 - 17:00 WIB");
    expect(sent[0]!.text).toContain("Jl. Uji No. 1");
    expect(sent[0]!.text).toContain("11 Juni 2026");
  });

  it("tidak mengirim dua kali untuk tanggal yang sama", async () => {
    const t = await setup();
    const w = await t.worker();
    const g = await t.gig(day("2026-06-11"));
    await t.apply(g, w.id);
    expect(await sendShiftReminders(NOW)).toBe(1);
    expect(await sendShiftReminders(NOW)).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it("melewati lowongan yang bukan besok, lamaran belum diterima, pekerja yang mematikan pengingat, dan escrow tak aktif", async () => {
    const t = await setup();
    const w1 = await t.worker();
    const w2 = await t.worker();
    const w3 = await t.worker({ notificationPrefs: { reminder: false } });
    const w4 = await t.worker();
    const lusa = await t.gig(day("2026-06-12"));
    const kemarin = await t.gig(day("2026-06-09"));
    const besok = await t.gig(day("2026-06-11"));
    const refunded = await t.gig(day("2026-06-11"), 1, "refunded");
    await t.apply(lusa, w1.id);
    await t.apply(kemarin, w1.id);
    await t.apply(besok, w2.id, "baru");
    await t.apply(besok, w3.id);
    await t.apply(refunded, w4.id);

    expect(await sendShiftReminders(NOW)).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("lowongan beberapa hari mengingatkan di tiap hari kerja, termasuk hari ke-2 dan ke-3", async () => {
    const t = await setup();
    const w = await t.worker();
    const g = await t.gig(day("2026-06-10"), 3); // 10, 11, 12 Juni
    await t.apply(g, w.id);
    expect(await sendShiftReminders(NOW)).toBe(1); // besok = 11 Juni (hari ke-2)
    expect(await sendShiftReminders(new Date("2026-06-11T10:00:00Z"))).toBe(1); // besok = 12 Juni (hari ke-3)
    expect(await sendShiftReminders(new Date("2026-06-12T10:00:00Z"))).toBe(0); // 13 Juni di luar masa kerja
  });

  it("endpoint cron wajib memakai CRON_SECRET", async () => {
    await request(app).get("/api/cron/shift-reminders").expect(503);
    process.env["CRON_SECRET"] = "rahasia-uji";
    await request(app).get("/api/cron/shift-reminders").set("Authorization", "Bearer salah").expect(401);
    const ok = await request(app).get("/api/cron/shift-reminders").set("Authorization", "Bearer rahasia-uji").expect(200);
    expect(ok.body.ok).toBe(true);
  });
});
