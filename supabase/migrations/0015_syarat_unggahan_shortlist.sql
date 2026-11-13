-- Syarat foto/file per pertanyaan + shortlist untuk klien agensi.
-- Aman dijalankan ulang (IF NOT EXISTS).

-- 1) Unggahan lamaran ditautkan ke pertanyaan perekrut (mis. "Foto KTP").
ALTER TABLE application_uploads ADD COLUMN IF NOT EXISTS question_id text;

-- 2) Shortlist + penilaian klien pada lamaran.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS shortlisted_at timestamptz;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS client_decision text;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS client_note text;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS client_decided_at timestamptz;

-- 3) Tautan klien: hanya hash token yang disimpan; tautan asli ditampilkan sekali saat dibuat.
CREATE TABLE IF NOT EXISTS client_share_links (
  id          serial PRIMARY KEY,
  company_id  text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id      bigint NOT NULL,
  token_hash  text NOT NULL UNIQUE,
  label       text NOT NULL DEFAULT '',
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS client_share_links_job_idx ON client_share_links (company_id, job_id);
