import {
  pgTable, serial, text, timestamp, pgEnum,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Anggota tim perusahaan — sub-akun yang bisa diundang pemberi kerja
 * untuk mengakses dashboard dengan hak terbatas.
 *
 * Role:
 *  - hr        : lihat lamaran, kelola pekerja, tidak bisa keuangan
 *  - supervisor: lihat presensi & gig yang ditugaskan saja
 *  - finance   : lihat & export laporan keuangan, tidak bisa kelola pekerja
 */
export const teamRoleEnum = pgEnum("team_role", ["hr", "supervisor", "finance"]);

export const companyTeamMembersTable = pgTable("company_team_members", {
  id:          serial("id").primaryKey(),
  companyId:   text("company_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  memberId:    text("member_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  role:        teamRoleEnum("role").notNull().default("hr"),
  invitedAt:   timestamp("invited_at",   { withTimezone: true }).notNull().defaultNow(),
  acceptedAt:  timestamp("accepted_at",  { withTimezone: true }),
  revokedAt:   timestamp("revoked_at",   { withTimezone: true }),
});

export type CompanyTeamMember = typeof companyTeamMembersTable.$inferSelect;
