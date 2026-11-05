import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { randomUUID } from "node:crypto";
import { and, eq, isNull, gt } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { getSessionUser, SESSION_COOKIE } from "../lib/auth";
import { sendTeamInvitationEmail } from "../lib/mailer";
import { keepAlive } from "../lib/vercel-context";

const router: IRouter = Router();

/** Cek apakah user adalah perusahaan dengan paket Business aktif */
async function requireBusinessPlan(userId: string): Promise<boolean> {
  const [user] = await db
    .select({ role: usersTable.role, expiredAt: usersTable.expiredAt })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!user || user.role !== "perusahaan") return false;
  if (!user.expiredAt) return false;
  // Business plan = paket dengan durasi >= 12 bulan, estimasi dari expiredAt
  // Untuk MVP: semua premium bisa akses, nanti bisa difilter per plan tier
  return new Date(user.expiredAt) > new Date();
}

/**
 * GET /api/team — daftar anggota tim saya (sebagai company)
 */
router.get("/team", async (req, res): Promise<void> => {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user) { res.status(401).json({ error: "Login diperlukan." }); return; }

  // Ambil langsung dari tabel — kita gunakan raw query karena tabel baru
  const members = await db.execute(
    `SELECT ctm.id, ctm.role, ctm.invited_at, ctm.accepted_at, ctm.revoked_at,
            u.name, u.email, u.id as member_id
     FROM company_team_members ctm
     JOIN users u ON u.id = ctm.member_id
     WHERE ctm.company_id = $1 AND ctm.revoked_at IS NULL
     ORDER BY ctm.invited_at DESC`,
    [user.id]
  );

  res.json({ members: members.rows });
});

/**
 * POST /api/team/invite — undang anggota tim via email
 * Body: { email, role: "hr"|"supervisor"|"finance" }
 */
router.post("/team/invite", async (req, res): Promise<void> => {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user) { res.status(401).json({ error: "Login diperlukan." }); return; }
  if (user.role !== "perusahaan") {
    res.status(403).json({ error: "Hanya akun perusahaan yang bisa mengundang tim." });
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
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 hari

  // Simpan undangan di ephemeral_kv sebagai JSON
  await db.execute(
    `INSERT INTO team_invitations (company_id, email, role, token, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (company_id) DO NOTHING`,
    [user.id, email.toLowerCase(), role, token, expiresAt.toISOString()]
  );

  // Kirim email undangan
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
 * Body: { token }
 */
router.post("/team/join", async (req, res): Promise<void> => {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user) { res.status(401).json({ error: "Login diperlukan." }); return; }

  const parsed = z.object({ token: z.string().min(10) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Token tidak valid." }); return; }

  const [inv] = (await db.execute(
    `SELECT * FROM team_invitations
     WHERE token = $1 AND accepted_at IS NULL AND expires_at > now() LIMIT 1`,
    [parsed.data.token]
  )).rows;

  if (!inv) {
    res.status(404).json({ error: "Undangan tidak ditemukan atau sudah kedaluwarsa." });
    return;
  }

  if ((inv.email as string).toLowerCase() !== user.email.toLowerCase()) {
    res.status(403).json({ error: "Undangan ini ditujukan untuk email yang berbeda." });
    return;
  }

  // Tambahkan ke tim
  await db.execute(
    `INSERT INTO company_team_members (company_id, member_id, role, accepted_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (company_id, member_id) DO UPDATE SET role = $3, revoked_at = NULL, accepted_at = now()`,
    [inv.company_id, user.id, inv.role]
  );

  // Tandai undangan sebagai diterima
  await db.execute(
    `UPDATE team_invitations SET accepted_at = now() WHERE token = $1`,
    [parsed.data.token]
  );

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

  await db.execute(
    `UPDATE company_team_members SET revoked_at = now()
     WHERE company_id = $1 AND member_id = $2`,
    [user.id, req.params.memberId]
  );

  res.json({ ok: true });
});

export default router;
