import { afterAll, describe, expect, it, vi } from "vitest";

// Harus di-set sebelum app diimpor (dibaca saat modul dimuat).
vi.hoisted(() => {
  process.env["GLOBAL_RATE_LIMIT_PER_MIN"] = "5";
});

import request from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { eq, like } from "drizzle-orm";
import { adminLoginAttemptsTable, db, ephemeralKvTable, pool, usersTable } from "@workspace/db";
import app from "./app.js";

afterAll(async () => {
  await db.delete(ephemeralKvTable).where(like(ephemeralKvTable.key, "global_rl:%"));
  await db.delete(adminLoginAttemptsTable).where(like(adminLoginAttemptsTable.ip, "user-a%"));
  await pool.end();
});

const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

describe("pembatas laju global", () => {
  it("membatasi per IP, header menyertakan sisa kuota, health tidak dibatasi", async () => {
    const client = ip();
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) {
      const r = await request(app).get("/api/notifications").set("X-Forwarded-For", client);
      codes.push(r.status);
      if (i === 0) expect(r.headers["x-ratelimit-limit"]).toBe("5");
    }
    expect(codes.slice(0, 5).every((c) => c !== 429)).toBe(true);
    expect(codes.slice(5)).toEqual([429, 429]);

    // IP lain tidak terpengaruh
    const other = await request(app).get("/api/notifications").set("X-Forwarded-For", ip());
    expect(other.status).not.toBe(429);

    // health tetap lolos walau IP sudah kena limit
    const health = await request(app).get("/api/healthz").set("X-Forwarded-For", client);
    expect(health.status).toBe(200);
  });

  it("window yang sudah kedaluwarsa direset (bug lama: tidak pernah reset)", async () => {
    const client = ip();
    for (let i = 0; i < 6; i++) await request(app).get("/api/notifications").set("X-Forwarded-For", client);
    const blocked = await request(app).get("/api/notifications").set("X-Forwarded-For", client);
    expect(blocked.status).toBe(429);

    await db
      .update(ephemeralKvTable)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(like(ephemeralKvTable.key, `global_rl:%${client}`));

    const again = await request(app).get("/api/notifications").set("X-Forwarded-For", client);
    expect(again.status).not.toBe(429);
  });

  it("/api/auth tidak dihitung pembatas global (punya throttle sendiri)", async () => {
    const client = ip();
    for (let i = 0; i < 8; i++) {
      const r = await request(app).get("/api/auth/config").set("X-Forwarded-For", client);
      expect(r.status).toBe(200);
    }
  });
});

describe("rate limit lupa/reset sandi memakai path yang benar", () => {
  it("forgot-password: request ke-6 dari IP yang sama ditolak 429", async () => {
    const client = ip();
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await request(app)
        .post("/api/auth/forgot-password")
        .set("X-Forwarded-For", client)
        .send({ email: `tidak-ada-${i}@example.test` });
      codes.push(r.status);
    }
    expect(codes.slice(0, 5).every((c) => c !== 429)).toBe(true);
    expect(codes[5]).toBe(429);
  });

  it("reset-password menolak sandi < 12 karakter", async () => {
    const r = await request(app)
      .post("/api/auth/reset-password")
      .set("X-Forwarded-For", ip())
      .send({ token: "x", newPassword: "pendek1234" });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toMatch(/12 karakter/);
  });
});

describe("kunci percobaan login", () => {
  async function mkUser() {
    const id = `sec-test-${randomUUID()}`;
    const email = `${id}@example.test`;
    await db.insert(usersTable).values({
      id, email, passwordHash: await bcrypt.hash("sandi-benar-12345", 4), name: "Uji", role: "pekerja",
    });
    return { id, email };
  }

  it("per akun: tebakan dari banyak IP berbeda tetap terkunci setelah 10 gagal", async () => {
    const u = await mkUser();
    try {
      for (let i = 0; i < 10; i++) {
        const r = await request(app)
          .post("/api/auth/login")
          .set("X-Forwarded-For", ip())
          .send({ email: u.email, password: "salah-salah-salah" });
        expect(r.status).toBe(401);
      }
      // IP baru + sandi BENAR tetap diblokir karena akun terkunci
      const locked = await request(app)
        .post("/api/auth/login")
        .set("X-Forwarded-For", ip())
        .send({ email: u.email, password: "sandi-benar-12345" });
      expect(locked.status).toBe(429);
    } finally {
      await db.delete(adminLoginAttemptsTable).where(eq(adminLoginAttemptsTable.ip, `user-acct:${u.email}`));
      await db.delete(usersTable).where(eq(usersTable.id, u.id));
    }
  });

  it("per IP: 5 gagal dari satu IP mengunci IP itu, IP lain tetap bisa masuk", async () => {
    const u = await mkUser();
    const attacker = ip();
    try {
      for (let i = 0; i < 5; i++) {
        const r = await request(app)
          .post("/api/auth/login")
          .set("X-Forwarded-For", attacker)
          .send({ email: `orang-${i}-${u.email}`, password: "salah-salah-salah" });
        expect(r.status).toBe(401);
      }
      const blocked = await request(app)
        .post("/api/auth/login").set("X-Forwarded-For", attacker)
        .send({ email: u.email, password: "sandi-benar-12345" });
      expect(blocked.status).toBe(429);

      const ok = await request(app)
        .post("/api/auth/login").set("X-Forwarded-For", ip())
        .send({ email: u.email, password: "sandi-benar-12345" });
      expect(ok.status).toBe(200);
    } finally {
      await db.delete(adminLoginAttemptsTable).where(like(adminLoginAttemptsTable.ip, "user-a%"));
      await db.delete(usersTable).where(eq(usersTable.id, u.id));
    }
  });

  it("login berhasil membersihkan hitungan gagal akun", async () => {
    const u = await mkUser();
    try {
      for (let i = 0; i < 3; i++) {
        await request(app).post("/api/auth/login").set("X-Forwarded-For", ip()).send({ email: u.email, password: "salah-salah-salah" });
      }
      const ok = await request(app).post("/api/auth/login").set("X-Forwarded-For", ip()).send({ email: u.email, password: "sandi-benar-12345" });
      expect(ok.status).toBe(200);
      const rows = await db.select().from(adminLoginAttemptsTable).where(eq(adminLoginAttemptsTable.ip, `user-acct:${u.email}`));
      expect(rows).toHaveLength(0);
    } finally {
      await db.delete(adminLoginAttemptsTable).where(like(adminLoginAttemptsTable.ip, "user-a%"));
      await db.delete(usersTable).where(eq(usersTable.id, u.id));
    }
  });
});
