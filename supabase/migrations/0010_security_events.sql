-- Migration 0010: catatan percobaan serangan (security_events)
-- Jalankan di Supabase SQL Editor sebelum/sesudah deploy (aman dijalankan ulang).

CREATE TABLE IF NOT EXISTS security_events (
  id          serial PRIMARY KEY,
  type        text NOT NULL,
  severity    text NOT NULL DEFAULT 'warn',
  ip          text,
  user_agent  text,
  method      text,
  path        text,
  detail      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS security_events_created_idx ON security_events (created_at DESC);
CREATE INDEX IF NOT EXISTS security_events_type_idx ON security_events (type, created_at DESC);

-- Data ini hanya boleh dibaca server (service role), bukan lewat API publik Supabase.
ALTER TABLE security_events ENABLE ROW LEVEL SECURITY;
