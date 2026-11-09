-- Migration 0008: tabel tim perusahaan (dipakai routes/team.ts)
-- Jalankan di Supabase SQL Editor sebelum deploy.

CREATE TABLE IF NOT EXISTS company_team_members (
  id          serial PRIMARY KEY,
  company_id  text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_id   text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        text NOT NULL DEFAULT 'hr',
  invited_at  timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  revoked_at  timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS company_team_members_company_member_unique
  ON company_team_members(company_id, member_id);

CREATE TABLE IF NOT EXISTS team_invitations (
  id          serial PRIMARY KEY,
  company_id  text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email       text NOT NULL,
  role        text NOT NULL DEFAULT 'hr',
  token       text NOT NULL,
  expires_at  timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS team_invitations_token_unique ON team_invitations(token);

ALTER TABLE company_team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_invitations     ENABLE ROW LEVEL SECURITY;
