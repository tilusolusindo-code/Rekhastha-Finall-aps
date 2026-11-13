import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

/** Peran anggota tim. (Peran "finance" sudah dihapus; keuangan hanya untuk pemilik.) */
export const TEAM_ROLES = ["hr", "supervisor"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export type TeamPermission =
  | "applications.view" // lihat lamaran (tanpa rekening/NIK/NPWP)
  | "applications.decide" // tandai ditinjau / diterima / ditolak
  | "gigs.view" // lihat lowongan perusahaan dan pekerja yang diterima
  | "attendance.view"; // lihat rekap presensi

export const ROLE_PERMISSIONS: Record<TeamRole, readonly TeamPermission[]> = {
  hr: ["applications.view", "applications.decide", "gigs.view"],
  supervisor: ["gigs.view", "attendance.view"],
};

export function isTeamRole(value: unknown): value is TeamRole {
  return typeof value === "string" && (TEAM_ROLES as readonly string[]).includes(value);
}

export function roleCan(role: string, permission: TeamPermission): boolean {
  return isTeamRole(role) && ROLE_PERMISSIONS[role].includes(permission);
}

export type Membership = {
  companyId: string;
  companyName: string;
  role: TeamRole;
  acceptedAt: string;
  permissions: readonly TeamPermission[];
};

/**
 * Keanggotaan aktif milik satu akun. Akses hanya berlaku bila undangan sudah diterima,
 * belum dicabut, perusahaan tidak ditangguhkan, dan paket Rekhastha Bisnis perusahaan
 * masih aktif. Bila paket habis, akses tim berhenti sampai diperpanjang.
 */
export async function listMemberships(userId: string): Promise<Membership[]> {
  const result = await db.execute<{ company_id: string; company_name: string; role: string; accepted_at: string }>(sql`
    SELECT ctm.company_id, u.name AS company_name, ctm.role::text AS role, ctm.accepted_at
    FROM company_team_members ctm
    JOIN users u ON u.id = ctm.company_id
    WHERE ctm.member_id = ${userId}
      AND ctm.revoked_at IS NULL
      AND ctm.accepted_at IS NOT NULL
      AND u.role = 'perusahaan'
      AND COALESCE(u.suspended, false) = false
      AND u.expired_at IS NOT NULL AND u.expired_at > now()
    ORDER BY ctm.accepted_at DESC
  `);
  return result.rows
    .filter((r) => isTeamRole(r.role))
    .map((r) => ({
      companyId: r.company_id,
      companyName: r.company_name,
      role: r.role as TeamRole,
      acceptedAt: new Date(r.accepted_at).toISOString(),
      permissions: ROLE_PERMISSIONS[r.role as TeamRole],
    }));
}

/** Apakah `userId` boleh melakukan `permission` atas data milik `companyId`? */
export async function teamCan(userId: string, companyId: string, permission: TeamPermission): Promise<boolean> {
  if (!companyId || userId === companyId) return false;
  const memberships = await listMemberships(userId);
  const m = memberships.find((x) => x.companyId === companyId);
  return !!m && m.permissions.includes(permission);
}

/** Paket Bisnis perusahaan aktif? */
export async function companyPlanActive(companyId: string): Promise<boolean> {
  const result = await db.execute<{ ok: boolean }>(sql`
    SELECT (role = 'perusahaan' AND COALESCE(suspended, false) = false AND expired_at IS NOT NULL AND expired_at > now()) AS ok
    FROM users WHERE id = ${companyId} LIMIT 1
  `);
  return result.rows[0]?.ok === true;
}
