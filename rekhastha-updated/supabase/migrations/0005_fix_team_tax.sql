-- Migration 0005: Fix undang tim + kolom PTKP untuk potongan pajak otomatis
-- Jalankan di Supabase SQL editor

-- 1. Pastikan tabel team_invitations ada (idempotent)
CREATE TABLE IF NOT EXISTS team_invitations (
  id           serial PRIMARY KEY,
  company_id   text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email        text NOT NULL,
  role         text NOT NULL DEFAULT 'hr',
  token        text NOT NULL UNIQUE,
  expires_at   timestamptz NOT NULL,
  accepted_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS team_inv_company_idx ON team_invitations(company_id);
CREATE INDEX IF NOT EXISTS team_inv_email_idx   ON team_invitations(email);
CREATE INDEX IF NOT EXISTS team_inv_token_idx   ON team_invitations(token);

-- 2. Pastikan tabel company_team_members ada (idempotent)
CREATE TABLE IF NOT EXISTS company_team_members (
  id           serial PRIMARY KEY,
  company_id   text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         text NOT NULL DEFAULT 'hr',
  invited_at   timestamptz NOT NULL DEFAULT now(),
  accepted_at  timestamptz,
  revoked_at   timestamptz,
  UNIQUE(company_id, member_id)
);

CREATE INDEX IF NOT EXISTS company_team_company_idx ON company_team_members(company_id);
CREATE INDEX IF NOT EXISTS company_team_member_idx  ON company_team_members(member_id);

-- 3. Tambah kolom status_ptkp ke worker_profiles (untuk hitung PPh21 otomatis)
--    Default TK/0 (tidak kawin, tanpa tanggungan)
DO $$ BEGIN
  ALTER TABLE worker_profiles ADD COLUMN IF NOT EXISTS status_ptkp text NOT NULL DEFAULT 'TK0';
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'Tabel worker_profiles belum ada, skip.';
END $$;

-- 4. RLS policies untuk team tables (agar aman di Supabase)
ALTER TABLE team_invitations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_team_members   ENABLE ROW LEVEL SECURITY;

-- Company hanya bisa baca/tulis undangan miliknya sendiri
DROP POLICY IF EXISTS "company_own_invitations" ON team_invitations;
CREATE POLICY "company_own_invitations" ON team_invitations
  FOR ALL USING (company_id = auth.uid()::text);

-- Member bisa baca undangan yang ditujukan ke emailnya (via join API)
DROP POLICY IF EXISTS "member_read_own_invitation" ON team_invitations;
CREATE POLICY "member_read_own_invitation" ON team_invitations
  FOR SELECT USING (email = (SELECT email FROM users WHERE id = auth.uid()::text));

-- Company bisa kelola anggota timnya; member bisa baca keanggotaannya sendiri
DROP POLICY IF EXISTS "company_manage_team" ON company_team_members;
CREATE POLICY "company_manage_team" ON company_team_members
  FOR ALL USING (company_id = auth.uid()::text);

DROP POLICY IF EXISTS "member_read_own_membership" ON company_team_members;
CREATE POLICY "member_read_own_membership" ON company_team_members
  FOR SELECT USING (member_id = auth.uid()::text);

COMMENT ON COLUMN team_invitations.role IS 'hr | supervisor | finance';
COMMENT ON TABLE  team_invitations       IS 'Token undangan email untuk bergabung sebagai anggota tim perusahaan';
COMMENT ON TABLE  company_team_members   IS 'Sub-akun tim perusahaan: HR, supervisor, finance';
