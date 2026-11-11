-- Tabel untuk mencatat export jobs yang dikirim ke Cloud Run
-- Run di Supabase SQL editor
CREATE TABLE IF NOT EXISTS export_jobs (
  id         serial PRIMARY KEY,
  type       text NOT NULL,
  status     text NOT NULL DEFAULT 'pending',   -- pending, processing, done, failed
  params     jsonb NOT NULL DEFAULT '{}',
  gcs_url    text,
  requested_by text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone
);
CREATE INDEX IF NOT EXISTS export_jobs_status_idx ON export_jobs (status, created_at DESC);

-- Audit log untuk aksi Google Cloud (opsional, berguna untuk debugging)
CREATE TABLE IF NOT EXISTS gcloud_audit (
  id         serial PRIMARY KEY,
  service    text NOT NULL,   -- 'gmail', 'gcs', 'cloud_run'
  action     text NOT NULL,
  success    boolean NOT NULL,
  meta       jsonb,
  at         timestamp with time zone NOT NULL DEFAULT now()
);
