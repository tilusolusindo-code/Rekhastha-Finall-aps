-- Migration 0004: Fitur tim perusahaan + kalkulator pajak
-- Jalankan di Supabase SQL editor

-- Enum role tim
DO $$ BEGIN
  CREATE TYPE team_role AS ENUM ('hr', 'supervisor', 'finance');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Tabel anggota tim perusahaan
CREATE TABLE IF NOT EXISTS company_team_members (
  id           serial PRIMARY KEY,
  company_id   text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         team_role NOT NULL DEFAULT 'hr',
  invited_at   timestamptz NOT NULL DEFAULT now(),
  accepted_at  timestamptz,
  revoked_at   timestamptz,
  UNIQUE(company_id, member_id)
);

CREATE INDEX IF NOT EXISTS company_team_company_idx ON company_team_members(company_id);
CREATE INDEX IF NOT EXISTS company_team_member_idx ON company_team_members(member_id);

-- Tabel token undangan tim (email invite link)
CREATE TABLE IF NOT EXISTS team_invitations (
  id           serial PRIMARY KEY,
  company_id   text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email        text NOT NULL,
  role         team_role NOT NULL DEFAULT 'hr',
  token        text NOT NULL UNIQUE,
  expires_at   timestamptz NOT NULL,
  accepted_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE company_team_members IS
  'Sub-akun tim perusahaan: HR, supervisor, finance — diundang oleh pemberi kerja paket Business';
COMMENT ON TABLE team_invitations IS
  'Token undangan email untuk bergabung sebagai anggota tim perusahaan';
