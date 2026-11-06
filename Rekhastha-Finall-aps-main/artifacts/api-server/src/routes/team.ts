import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { getSessionUser, SESSION_COOKIE } from "../lib/auth";
import { sendTeamInvitationEmail } from "../lib/mailer";
import { keepAlive } from "../lib/vercel-context";

const router: IRouter = Router();

/** Cek apakah user adalah perusahaan dengan paket premium aktif */
async function requirePremium(userId: string): Promise<boolean> {
  const [user] = await db
    .select({ role: usersTable.role, expiredAt: usersTable.expiredAt })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!user || user.role !== "perusahaan") return false;
  if (!user.expiredAt) return false;
  return new Date(user.expiredAt) > new Date();
}

/**
 * GET /api/team — daftar anggota tim
 */
router.get("/team", async (req, res): Promise<void> => {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user) { res.status(401).json({ error: "Login diperlukan." }); return; }

  try {
    const result = await db.execute(sql`
      SELECT ctm.id, ctm.role, ctm.invited_at, ctm.accepted_at, ctm.revoked_at,
             u.name, u.email, u.id as member_id
      FROM company_team_members ctm
      JOIN users u ON u.id = ctm.member_id
      WHERE ctm.company_id = ${user.id} AND ctm.revoked_at IS NULL
      ORDER BY ctm.invited_at DESC
    `);
    res.json({ members: result.rows });
  } catch (err) {
    req.log?.warn({ err }, "GET /team failed");
    res.status(500).json({ error: "Gagal memuat anggota tim." });
  }
});

/**
 * POST /api/team/invite — undang anggota tim via email
 */
router.post("/team/invite", async (req, res): Promise<void> => {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user) { res.status(401).json({ error: "Login diperlukan." }); return; }
  if (user.role !== "perusahaan") {
    res.status(403).json({ error: "Hanya akun perusahaan yang bisa mengundang tim." });
    return;
  }

  const hasPremium = await requirePremium(user.id);
  if (!hasPremium) {
    res.status(403).json({ error: "Fitur tim memerlukan paket Rekhastha Bisnis aktif." });
    return;
  }

  const parsed = z.object({
    email: z.email(),
    role: z.enum(["hr", "supervisor", "finance"]).default("hr"),
  }).safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Email atau role tidak valid." });
    return;
  }

  const { email, role } = parsed.data;

  // Cek apakah email sudah terdaftar di Rekhastha
  const [targetUser] = await db
    .select({ id: usersTable.id, name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase()))
    .limit(1);

  if (!targetUser) {
    res.status(404).json({ error: `Email ${email} belum terdaftar di Rekhastha. Minta calon anggota daftar dulu.` });
    return;
  }

  if (targetUser.id === user.id) {
    res.status(400).json({ error: "Tidak bisa mengundang diri sendiri." });
    return;
  }

  // Cek apakah sudah jadi anggota
  const existing = await db.execute(sql`
    SELECT id FROM company_team_members
    WHERE company_id = ${user.id} AND member_id = ${targetUser.id} AND revoked_at IS NULL
    LIMIT 1
  `);
  if (existing.rows.length > 0) {
    res.status(409).json({ error: `${targetUser.name} sudah menjadi anggota tim Anda.` });
    return;
  }

  const token = randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  try {
    await db.execute(sql`
      INSERT INTO team_invitations (company_id, email, role, token, expires_at)
      VALUES (${user.id}, ${email.toLowerCase()}, ${role}, ${token}, ${expiresAt.toISOString()})
      ON CONFLICT (token) DO NOTHING
    `);
  } catch (err) {
    req.log?.error({ err }, "Failed to insert team invitation");
    res.status(500).json({ error: "Gagal menyimpan undangan. Coba lagi." });
    return;
  }

  const baseUrl = process.env["APP_BASE_URL"] ?? "https://rekhastha.my.id";
  const link = `${baseUrl}/?join_team=${token}`;

  keepAlive(
    sendTeamInvitationEmail({
      to: email,
      companyName: user.name,
      role,
      link,
    }).then(() => undefined)
  );

  res.json({ ok: true, message: `Undangan dikirim ke ${email}` });
});

/**
 * POST /api/team/join — terima undangan tim
 */
router.post("/team/join", async (req, res): Promise<void> => {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user) { res.status(401).json({ error: "Login diperlukan." }); return; }

  const parsed = z.object({ token: z.string().min(10) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Token tidak valid." }); return; }

  const invResult = await db.execute(sql`
    SELECT * FROM team_invitations
    WHERE token = ${parsed.data.token}
      AND accepted_at IS NULL
      AND expires_at > now()
    LIMIT 1
  `);

  const inv = invResult.rows[0];
  if (!inv) {
    res.status(404).json({ error: "Undangan tidak ditemukan atau sudah kedaluwarsa." });
    return;
  }

  if ((inv.email as string).toLowerCase() !== user.email.toLowerCase()) {
    res.status(403).json({ error: "Undangan ini ditujukan untuk email yang berbeda." });
    return;
  }

  await db.execute(sql`
    INSERT INTO company_team_members (company_id, member_id, role, accepted_at)
    VALUES (${inv.company_id}, ${user.id}, ${inv.role}, now())
    ON CONFLICT (company_id, member_id)
    DO UPDATE SET role = ${inv.role}, revoked_at = NULL, accepted_at = now()
  `);

  await db.execute(sql`
    UPDATE team_invitations SET accepted_at = now() WHERE token = ${parsed.data.token}
  `);

  res.json({ ok: true, companyId: inv.company_id, role: inv.role });
});

/**
 * DELETE /api/team/:memberId — hapus anggota dari tim
 */
router.delete("/team/:memberId", async (req, res): Promise<void> => {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user || user.role !== "perusahaan") {
    res.status(401).json({ error: "Akses ditolak." });
    return;
  }

  await db.execute(sql`
    UPDATE company_team_members SET revoked_at = now()
    WHERE company_id = ${user.id} AND member_id = ${req.params.memberId}
  `);

  res.json({ ok: true });
});

export default router;
