-- Migration 0012: preferensi notifikasi email + pekerja favorit
ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_prefs jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS favorite_workers (
  employer_id text NOT NULL,
  worker_id   text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (employer_id, worker_id)
);
CREATE INDEX IF NOT EXISTS favorite_workers_worker_idx ON favorite_workers (worker_id);

-- Tabel diakses hanya lewat API server (service role); aktifkan RLS tanpa kebijakan publik.
ALTER TABLE favorite_workers ENABLE ROW LEVEL SECURITY;
