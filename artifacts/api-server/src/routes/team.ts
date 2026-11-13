import { Router, type IRouter } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, usersTable, notificationsTable } from "@workspace/db";
import { getSessionUser, SESSION_COOKIE } from "../lib/auth";
import { sendTeamInvitationEmail } from "../lib/mailer";
import { keepAlive } from "../lib/vercel-context";

const router: IRouter = Router();

/** Cek apakah user adalah perusahaan dengan paket aktif */
async function requireBusinessPlan(userId: string): Promise<boolean> {
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
 * GET /api/team — daftar anggota tim saya (sebagai company)
 */
router.get("/team", async (req, res): Promise<void> => {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user) { res.status(401).json({ error: "Login diperlukan." }); return; }

  try {
    const members = await db.execute(sql`
      SELECT ctm.id, ctm.role, ctm.invited_at, ctm.accepted_at, ctm.revoked_at,
             u.name, u.email, u.id as member_id
      FROM company_team_members ctm
      JOIN users u ON u.id = ctm.member_id
      WHERE ctm.company_id = ${user.id} AND ctm.revoked_at IS NULL
      ORDER BY ctm.invited_at DESC
    `);
    res.json({ members: members.rows });
  } catch (err) {
    console.error("[team] GET /team error:", err);
    if ((err as any)?.message?.includes("does not exist")) {
      res.json({ members: [] });
    } else {
      res.status(500).json({ error: "Gagal memuat daftar tim." });
    }
  }
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

  const InviteSchema = z.object({
    email: z.string().email("Format email tidak valid."),
    role: z.enum(["hr", "supervisor", "finance"]).default("hr"),
  });

  const parsed = InviteSchema.safeParse(req.body);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "Email atau role tidak valid.";
    res.status(400).json({ error: msg });
    return;
  }

  const { email, role } = parsed.data;

  // Fitur tim hanya untuk perusahaan dengan paket Bisnis yang masih aktif.
  if (!(await requireBusinessPlan(user.id))) {
    res.status(403).json({ error: "Fitur tim memerlukan paket Rekhastha Bisnis yang aktif." });
    return;
  }

  try {
    // Cek apakah user dengan email ini sudah terdaftar
    const [targetUser] = await db
      .select({ id: usersTable.id, name: usersTable.name, role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.email, email.toLowerCase()))
      .limit(1);

    // Akun pekerja tidak boleh ditambahkan diam-diam sebagai anggota tim perusahaan.
    if (targetUser && targetUser.role !== "perusahaan") {
      res.status(409).json({ error: "Email ini terdaftar sebagai akun pekerja. Gunakan email akun perusahaan." });
      return;
    }

    // Jika user sudah terdaftar, langsung tambah ke tim
    if (targetUser) {
      await db.execute(sql`
        INSERT INTO company_team_members (company_id, member_id, role, invited_at, accepted_at)
        VALUES (${user.id}, ${targetUser.id}, ${role}, now(), now())
        ON CONFLICT (company_id, member_id) DO UPDATE
          SET role = ${role}, revoked_at = NULL, accepted_at = now()
      `);
      // Kirim notifikasi ke akun yang diundang
      await db.insert(notificationsTable).values({
        userId: targetUser.id,
        message: `Anda telah ditambahkan sebagai anggota tim ${user.name} dengan akses ${role.toUpperCase()}.`,
        type: "team_invite",
      }).catch(() => { /* notif gagal tidak memblokir */ });
      res.json({ ok: true, message: `${targetUser.name} (${email}) berhasil ditambahkan ke tim.`, directAdded: true });
      return;
    }

    // User belum terdaftar → kirim undangan via email
    const token = randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await db.execute(sql`
      INSERT INTO team_invitations (company_id, email, role, token, expires_at)
      VALUES (${user.id}, ${email.toLowerCase()}, ${role}, ${token}, ${expiresAt.toISOString()})
      ON CONFLICT (token) DO NOTHING
    `);

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

    res.json({ ok: true, message: `Undangan dikirim ke ${email}. Link berlaku 7 hari.` });
  } catch (err) {
    console.error("[team] /team/invite error:", err);
    if ((err as any)?.message?.includes("does not exist")) {
      res.status(503).json({
        error: "Tabel tim belum siap. Jalankan migration 0005_fix_team_tax.sql di Supabase.",
      });
    } else {
      res.status(500).json({ error: "Gagal mengirim undangan. Coba lagi." });
    }
  }
});

/**
 * POST /api/team/join — terima undangan tim via link
 * Body: { token }
 */
router.post("/team/join", async (req, res): Promise<void> => {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user) { res.status(401).json({ error: "Login diperlukan." }); return; }

  const parsed = z.object({ token: z.string().min(10) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Token tidak valid." }); return; }

  try {
    const result = await db.execute(sql`
      SELECT * FROM team_invitations
      WHERE token = ${parsed.data.token}
        AND accepted_at IS NULL
        AND expires_at > now()
      LIMIT 1
    `);
    const inv = result.rows[0];

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
      ON CONFLICT (company_id, member_id) DO UPDATE
        SET role = ${inv.role}, revoked_at = NULL, accepted_at = now()
    `);

    await db.execute(sql`
      UPDATE team_invitations SET accepted_at = now()
      WHERE token = ${parsed.data.token}
    `);

    res.json({ ok: true, companyId: inv.company_id, role: inv.role });
  } catch (err) {
    console.error("[team] /team/join error:", err);
    res.status(500).json({ error: "Gagal bergabung ke tim." });
  }
});

/**
 * GET /api/team/my-membership — info tim tempat user ini bergabung (dari sisi anggota)
 */
router.get("/team/my-membership", async (req, res): Promise<void> => {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user) { res.status(401).json({ error: "Login diperlukan." }); return; }

  try {
    const result = await db.execute(sql`
      SELECT ctm.role, ctm.accepted_at, ctm.invited_at,
             u.id as company_id, u.name as company_name, u.email as company_email,
             u.name as nama_perusahaan
      FROM company_team_members ctm
      JOIN users u ON u.id = ctm.company_id
      WHERE ctm.member_id = ${user.id}
        AND ctm.revoked_at IS NULL
      ORDER BY ctm.accepted_at DESC
      LIMIT 1
    `);
    const membership = result.rows[0] ?? null;
    res.json({ membership });
  } catch (err) {
    console.error("[team] /team/my-membership error:", err);
    res.json({ membership: null });
  }
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

  try {
    await db.execute(sql`
      UPDATE company_team_members SET revoked_at = now()
      WHERE company_id = ${user.id} AND member_id = ${req.params.memberId}
    `);
    res.json({ ok: true });
  } catch (err) {
    console.error("[team] DELETE error:", err);
    res.status(500).json({ error: "Gagal menghapus anggota." });
  }
});

export default router;
