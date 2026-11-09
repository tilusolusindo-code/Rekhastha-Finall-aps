import { afterAll, afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { eq, or } from "drizzle-orm";
import { companyTeamMembersTable, db, notificationsTable, pool, usersTable } from "@workspace/db";
import app from "../app.js";
import { createSession, deleteSession, SESSION_COOKIE } from "../lib/auth.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const c of cleanups.splice(0).reverse()) await c(); });
afterAll(async () => { await pool.end(); });

async function mk(role: "pekerja" | "perusahaan") {
  const id = `team-test-${randomUUID()}`;
  await db.insert(usersTable).values({
    id, email: `${id}@example.test`, passwordHash: "x", name: `Tim ${role}`, role,
    expiredAt: new Date(Date.now() + 30 * 86400_000), isPremium: true,
  });
  const token = await createSession(id);
  cleanups.push(async () => {
    await deleteSession(token);
    await db.delete(notificationsTable).where(eq(notificationsTable.userId, id));
    await db.delete(companyTeamMembersTable).where(or(eq(companyTeamMembersTable.companyId, id), eq(companyTeamMembersTable.memberId, id)));
    await db.delete(usersTable).where(eq(usersTable.id, id));
  });
  return { id, email: `${id}@example.test`, token };
}

describe("team routes memakai tabel company_team_members", () => {
  it("undang user terdaftar lalu tampil di daftar tim", async () => {
    const co = await mk("perusahaan");
    const member = await mk("pekerja");
    const inv = await request(app)
      .post("/api/team/invite")
      .set("Cookie", `${SESSION_COOKIE}=${co.token}`)
      .send({ email: member.email, role: "hr" });
    expect(inv.status).toBe(200);
    expect(inv.body.directAdded).toBe(true);

    const list = await request(app).get("/api/team").set("Cookie", `${SESSION_COOKIE}=${co.token}`);
    expect(list.status).toBe(200);
    expect(list.body.members).toHaveLength(1);
    expect(list.body.members[0].member_id).toBe(member.id);
  });
});
