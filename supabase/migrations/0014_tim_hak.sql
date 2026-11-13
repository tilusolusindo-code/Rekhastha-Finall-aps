-- Migration 0014: hak tim yang nyata. Peran "finance" dihapus.
-- Anggota finance yang ada dicabut aksesnya (tidak diubah menjadi HR agar tidak ada
-- yang mendapat akses baru tanpa sepengetahuan pemilik). Undangan finance yang
-- masih tertunda dihapus. Nilai enum 'finance' dibiarkan (Postgres tidak bisa
-- menghapus nilai enum dengan aman); aplikasi menolaknya.
UPDATE company_team_members SET revoked_at = now() WHERE role = 'finance' AND revoked_at IS NULL;
DELETE FROM team_invitations WHERE role = 'finance' AND accepted_at IS NULL;

-- Satu anggota hanya satu baris per perusahaan (dipakai ON CONFLICT di API).
CREATE UNIQUE INDEX IF NOT EXISTS company_team_unique_member ON company_team_members (company_id, member_id);
