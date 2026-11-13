-- Migration 0012: verifikasi email saat daftar
-- Semua akun yang SUDAH ada dianggap terverifikasi (default true).
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  token       text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_verification_tokens_user_idx ON email_verification_tokens (user_id);

-- Hanya server yang boleh membaca token (bukan lewat API publik Supabase).
ALTER TABLE email_verification_tokens ENABLE ROW LEVEL SECURITY;
