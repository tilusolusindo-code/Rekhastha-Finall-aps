import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, usersTable, notificationsTable } from "@workspace/db";
import { getSessionUser, SESSION_COOKIE } from "../lib/auth";
import { sendTeamInvitationEmail } from "../lib/mailer";
import { keepAlive } from "../lib/vercel-context";
import { companyPlanActive, isTeamRole, listMemberships, ROLE_PERMISSIONS, TEAM_ROLES, type TeamRole } from "../lib/team-access";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/** Anggota aktif + undangan tertunda yang boleh ada sekaligus per perusahaan. */
const MAX_TEAM_SLOTS = 10;
/** Batas undangan baru per perusahaan per 24 jam (mencegah kiriman email massal). */
const MAX_INVITES_PER_DAY = 20;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type SessionUser = NonNullable<Awaited<ReturnType<typeof getSessionUser>>>;

async function sessionUser(req: Request, res: Response): Promise<SessionUser | null> {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user) {
    res.status(401).json({ error: "Login diperlukan." });
    return null;
  }
  return user;
}

/** Hanya akun pemilik (perusahaan) yang mengelola tim. */
async function requireOwner(req: Request, res: Response): Promise<SessionUser | null> {
  const user = await sessionUser(req, res);
  if (!user) return null;
  if (user.role !== "perusahaan") {
    res.status(403).json({ error: "Hanya akun perusahaan yang bisa mengelola tim." });
    return null;
  }
  return user;
}

const memberIdParam = (req: Request): string => String(req.params["memberId"] ?? "");
const numericParam = (req: Request, name: string): number => Number(req.params[name]);

/** Terima undangan: jadikan anggota aktif lalu tutup undangannya, dalam satu transaksi. */
async function acceptInvitation(
  inv: { id: number; company_id: string; role: string },
  user: SessionUser,
): Promise<{ ok: true; companyId: string; role: TeamRole } | { ok: false; status: number; error: string }> {
  if (!isTeamRole(inv.role)) {
    return { ok: false, status: 410, error: "Peran undangan ini sudah tidak tersedia. Minta pemilik mengirim undangan baru." };
  }
  if (user.role !== "pekerja") {
    return { ok: false, status: 403, error: "Hanya akun pekerja yang dapat bergabung sebagai anggota tim." };
  }
  if (inv.company_id === user.id) {
    return { ok: false, status: 400, error: "Undangan tidak valid." };
  }
  if (!(await companyPlanActive(inv.company_id))) {
    return { ok: false, status: 409, error: "Paket Rekhastha Bisnis perusahaan ini sedang tidak aktif." };
  }
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO company_team_members (company_id, member_id, role, invited_at, accepted_at)
      VALUES (${inv.company_id}, ${user.id}, ${inv.role}::team_role, now(), now())
      ON CONFLICT (company_id, member_id) DO UPDATE
        SET role = ${inv.role}::team_role, revoked_at = NULL, accepted_at = now()
    `);
    await tx.execute(sql`UPDATE team_invitations SET accepted_at = now() WHERE id = ${inv.id}`);
  });
  return { ok: true, companyId: inv.company_id, role: inv.role };
}

/**
 * GET /api/team — anggota aktif dan undangan tertunda milik perusahaan saya.
 */
router.get("/team", async (req, res): Promise<void> => {
  const user = await requireOwner(req, res);
  if (!user) return;
  try {
    const members = await db.execute(sql`
      SELECT ctm.id, ctm.role::text AS role, ctm.invited_at, ctm.accepted_at,
             u.name, u.email, u.id AS member_id
      FROM company_team_members ctm
      JOIN users u ON u.id = ctm.member_id
      WHERE ctm.company_id = ${user.id} AND ctm.revoked_at IS NULL AND ctm.role::text <> 'finance'
      ORDER BY ctm.invited_at DESC
    `);
    const invitations = await db.execute(sql`
      SELECT id, email, role::text AS role, expires_at, created_at
      FROM team_invitations
      WHERE company_id = ${user.id} AND accepted_at IS NULL AND expires_at > now() AND role::text <> 'finance'
      ORDER BY created_at DESC
    `);
    res.json({ members: members.rows, invitations: invitations.rows, maxSlots: MAX_TEAM_SLOTS });
  } catch (err) {
    logger.error({ err }, "[team] GET /team gagal");
    res.status(500).json({ error: "Gagal memuat daftar tim." });
  }
});

/**
 * POST /api/team/invite — undang anggota tim lewat email. Selalu berupa undangan yang
 * harus DITERIMA orang tersebut (tidak ada penambahan sepihak).
 */
router.post("/team/invite", async (req, res): Promise<void> => {
  const user = await requireOwner(req, res);
  if (!user) return;

  const parsed = z
    .object({
      email: z.string().trim().toLowerCase().email("Format email tidak valid.").max(254),
      role: z.enum(TEAM_ROLES, { error: "Peran tidak valid. Pilih HR atau Supervisor." }),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Email atau peran tidak valid." });
    return;
  }
  const { email, role } = parsed.data;

  if (!(await companyPlanActive(user.id))) {
    res.status(402).json({ error: "Fitur tim memerlukan paket Rekhastha Bisnis yang aktif." });
    return;
  }
  if (email === user.email.toLowerCase()) {
    res.status(400).json({ error: "Anda tidak bisa mengundang akun Anda sendiri." });
    return;
  }

  try {
    const [target] = await db
      .select({ id: usersTable.id, role: usersTable.role, suspended: usersTable.suspended })
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);
    // Hanya akun pekerja yang bisa menjadi anggota tim; akun perusahaan/admin tidak.
    if (target && (target.role !== "pekerja" || target.suspended)) {
      res.status(400).json({ error: "Email ini tidak dapat diundang ke tim." });
      return;
    }
    if (target) {
      const already = await db.execute(sql`
        SELECT 1 FROM company_team_members
        WHERE company_id = ${user.id} AND member_id = ${target.id} AND revoked_at IS NULL AND accepted_at IS NOT NULL
        LIMIT 1
      `);
      if (already.rows.length > 0) {
        res.status(409).json({ error: "Akun ini sudah menjadi anggota tim Anda." });
        return;
      }
    }

    const slots = await db.execute<{ n: number }>(sql`
      SELECT (
        (SELECT count(*) FROM company_team_members WHERE company_id = ${user.id} AND revoked_at IS NULL AND accepted_at IS NOT NULL)
        +
        (SELECT count(*) FROM team_invitations WHERE company_id = ${user.id} AND accepted_at IS NULL AND expires_at > now() AND email <> ${email})
      )::int AS n
    `);
    if ((slots.rows[0]?.n ?? 0) >= MAX_TEAM_SLOTS) {
      res.status(409).json({ error: `Tim penuh (maksimal ${MAX_TEAM_SLOTS} anggota termasuk undangan tertunda).` });
      return;
    }
    const recent = await db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM team_invitations
      WHERE company_id = ${user.id} AND created_at > now() - interval '24 hours'
    `);
    if ((recent.rows[0]?.n ?? 0) >= MAX_INVITES_PER_DAY) {
      res.status(429).json({ error: "Terlalu banyak undangan hari ini. Coba lagi besok." });
      return;
    }

    const token = randomUUID();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    // Undangan tertunda untuk email yang sama diperbarui (peran/token/kedaluwarsa), bukan digandakan.
    const refreshed = await db.execute(sql`
      UPDATE team_invitations
      SET role = ${role}::team_role, token = ${token}, expires_at = ${expiresAt.toISOString()}, created_at = now()
      WHERE company_id = ${user.id} AND email = ${email} AND accepted_at IS NULL
      RETURNING id
    `);
    if (refreshed.rows.length === 0) {
      await db.execute(sql`
        INSERT INTO team_invitations (company_id, email, role, token, expires_at)
        VALUES (${user.id}, ${email}, ${role}::team_role, ${token}, ${expiresAt.toISOString()})
      `);
    }

    if (target) {
      await db
        .insert(notificationsTable)
        .values({
          userId: target.id,
          message: `${user.name} mengundang Anda bergabung ke tim sebagai ${role === "hr" ? "HR / Rekrutmen" : "Supervisor Lapangan"}. Buka profil untuk menerima atau menolak.`,
          type: "team_invite",
        })
        .catch(() => { /* notif gagal tidak memblokir */ });
    }

    const baseUrl = process.env["APP_BASE_URL"] ?? "https://rekhastha.my.id";
    keepAlive(
      sendTeamInvitationEmail({
        to: email,
        companyName: user.name,
        role,
        link: `${baseUrl}/?join_team=${token}`,
      }).then(() => undefined, (err) => logger.error({ err }, "[team] email undangan gagal")),
    );

    // Jawaban sama untuk akun terdaftar maupun belum, agar daftar email tidak bisa ditebak.
    res.json({ ok: true, message: `Undangan dikirim ke ${email}. Berlaku 7 hari dan harus diterima oleh yang bersangkutan.` });
  } catch (err) {
    logger.error({ err }, "[team] /team/invite gagal");
    res.status(500).json({ error: "Gagal mengirim undangan. Coba lagi." });
  }
});

/** DELETE /api/team/invitations/:id — pemilik membatalkan undangan tertunda. */
router.delete("/team/invitations/:id", async (req, res): Promise<void> => {
  const user = await requireOwner(req, res);
  if (!user) return;
  const id = numericParam(req, "id");
  if (!Number.isSafeInteger(id) || id <= 0) { res.status(400).json({ error: "ID tidak valid." }); return; }
  const result = await db.execute(sql`
    DELETE FROM team_invitations WHERE id = ${id} AND company_id = ${user.id} AND accepted_at IS NULL RETURNING id
  `);
  if (result.rows.length === 0) { res.status(404).json({ error: "Undangan tidak ditemukan." }); return; }
  res.json({ ok: true });
});

/** GET /api/team/invitations/mine — undangan tim yang menunggu keputusan saya. */
router.get("/team/invitations/mine", async (req, res): Promise<void> => {
  const user = await sessionUser(req, res);
  if (!user) return;
  const rows = await db.execute(sql`
    SELECT ti.id, ti.role::text AS role, ti.expires_at, u.name AS company_name
    FROM team_invitations ti
    JOIN users u ON u.id = ti.company_id
    WHERE lower(ti.email) = ${user.email.toLowerCase()}
      AND ti.accepted_at IS NULL AND ti.expires_at > now() AND ti.role::text <> 'finance'
    ORDER BY ti.created_at DESC
  `);
  res.setHeader("Cache-Control", "no-store");
  res.json({ invitations: rows.rows });
});

async function findMyInvitation(id: number, user: SessionUser) {
  const result = await db.execute<{ id: number; company_id: string; role: string }>(sql`
    SELECT id, company_id, role::text AS role FROM team_invitations
    WHERE id = ${id} AND lower(email) = ${user.email.toLowerCase()} AND accepted_at IS NULL AND expires_at > now()
    LIMIT 1
  `);
  return result.rows[0] ?? null;
}

/** POST /api/team/invitations/:id/accept */
router.post("/team/invitations/:id/accept", async (req, res): Promise<void> => {
  const user = await sessionUser(req, res);
  if (!user) return;
  const id = numericParam(req, "id");
  if (!Number.isSafeInteger(id) || id <= 0) { res.status(400).json({ error: "ID tidak valid." }); return; }
  const inv = await findMyInvitation(id, user);
  if (!inv) { res.status(404).json({ error: "Undangan tidak ditemukan atau sudah kedaluwarsa." }); return; }
  const result = await acceptInvitation(inv, user);
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  res.json({ ok: true, companyId: result.companyId, role: result.role });
});

/** POST /api/team/invitations/:id/decline */
router.post("/team/invitations/:id/decline", async (req, res): Promise<void> => {
  const user = await sessionUser(req, res);
  if (!user) return;
  const id = numericParam(req, "id");
  if (!Number.isSafeInteger(id) || id <= 0) { res.status(400).json({ error: "ID tidak valid." }); return; }
  const inv = await findMyInvitation(id, user);
  if (!inv) { res.status(404).json({ error: "Undangan tidak ditemukan atau sudah kedaluwarsa." }); return; }
  await db.execute(sql`DELETE FROM team_invitations WHERE id = ${id}`);
  res.json({ ok: true });
});

/**
 * POST /api/team/join — terima undangan lewat tautan email. Body: { token }
 */
router.post("/team/join", async (req, res): Promise<void> => {
  const user = await sessionUser(req, res);
  if (!user) return;
  const parsed = z.object({ token: z.string().min(10).max(100) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Token tidak valid." }); return; }

  try {
    const found = await db.execute<{ id: number; company_id: string; email: string; role: string }>(sql`
      SELECT id, company_id, email, role::text AS role FROM team_invitations
      WHERE token = ${parsed.data.token} AND accepted_at IS NULL AND expires_at > now()
      LIMIT 1
    `);
    const inv = found.rows[0];
    if (!inv) { res.status(404).json({ error: "Undangan tidak ditemukan atau sudah kedaluwarsa." }); return; }
    if (inv.email.toLowerCase() !== user.email.toLowerCase()) {
      res.status(403).json({ error: "Undangan ini ditujukan untuk email yang berbeda." });
      return;
    }
    const result = await acceptInvitation(inv, user);
    if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
    res.json({ ok: true, companyId: result.companyId, role: result.role });
  } catch (err) {
    logger.error({ err }, "[team] /team/join gagal");
    res.status(500).json({ error: "Gagal bergabung ke tim." });
  }
});

/**
 * GET /api/team/my-membership — tim tempat saya menjadi anggota (aktif saja), beserta hak per tim.
 * `membership` = tim terbaru (kompatibilitas), `memberships` = semuanya.
 */
router.get("/team/my-membership", async (req, res): Promise<void> => {
  const user = await sessionUser(req, res);
  if (!user) return;
  try {
    const memberships = await listMemberships(user.id);
    res.setHeader("Cache-Control", "no-store");
    res.json({ membership: memberships[0] ?? null, memberships, rolePermissions: ROLE_PERMISSIONS });
  } catch (err) {
    logger.error({ err }, "[team] /team/my-membership gagal");
    res.json({ membership: null, memberships: [] });
  }
});

/** DELETE /api/team/membership/:companyId — saya keluar dari tim perusahaan itu. */
router.delete("/team/membership/:companyId", async (req, res): Promise<void> => {
  const user = await sessionUser(req, res);
  if (!user) return;
  const result = await db.execute(sql`
    UPDATE company_team_members SET revoked_at = now()
    WHERE company_id = ${String(req.params["companyId"] ?? "")} AND member_id = ${user.id} AND revoked_at IS NULL
    RETURNING id
  `);
  if (result.rows.length === 0) { res.status(404).json({ error: "Anda bukan anggota tim ini." }); return; }
  res.json({ ok: true });
});

/** PATCH /api/team/:memberId — pemilik mengubah peran anggota. Body: { role } */
router.patch("/team/:memberId", async (req, res): Promise<void> => {
  const user = await requireOwner(req, res);
  if (!user) return;
  const parsed = z.object({ role: z.enum(TEAM_ROLES) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Peran tidak valid. Pilih HR atau Supervisor." }); return; }
  const result = await db.execute(sql`
    UPDATE company_team_members SET role = ${parsed.data.role}::team_role
    WHERE company_id = ${user.id} AND member_id = ${memberIdParam(req)} AND revoked_at IS NULL AND accepted_at IS NOT NULL
    RETURNING member_id
  `);
  if (result.rows.length === 0) { res.status(404).json({ error: "Anggota tidak ditemukan." }); return; }
  res.json({ ok: true, role: parsed.data.role });
});

/** DELETE /api/team/:memberId — pemilik mengeluarkan anggota. */
router.delete("/team/:memberId", async (req, res): Promise<void> => {
  const user = await requireOwner(req, res);
  if (!user) return;
  try {
    const result = await db.execute(sql`
      UPDATE company_team_members SET revoked_at = now()
      WHERE company_id = ${user.id} AND member_id = ${memberIdParam(req)} AND revoked_at IS NULL
      RETURNING member_id
    `);
    if (result.rows.length === 0) { res.status(404).json({ error: "Anggota tidak ditemukan." }); return; }
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "[team] DELETE gagal");
    res.status(500).json({ error: "Gagal menghapus anggota." });
  }
});

export default router;
