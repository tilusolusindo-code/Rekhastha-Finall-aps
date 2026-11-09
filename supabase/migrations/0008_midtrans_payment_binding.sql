-- Migration 0008: Midtrans payments bound to the payer and to a server-side
-- obligation (manual_payments). Safe to run more than once, and safe whether
-- or not `drizzle-kit push` already created the table.
-- Jalankan di Supabase SQL Editor SEBELUM deploy API yang baru.

CREATE TABLE IF NOT EXISTS midtrans_payments (
  id                 serial PRIMARY KEY,
  order_id           text NOT NULL UNIQUE,
  job_id             text,
  job_type           text NOT NULL,
  gross_amount       integer NOT NULL,
  status             text NOT NULL DEFAULT 'pending',
  transaction_id     text,
  transaction_status text,
  payment_type       text,
  fraud_status       text,
  transaction_time   timestamptz,
  settlement_time    timestamptz,
  customer_details   jsonb,
  raw_notification   jsonb,
  snap_token         text,
  redirect_url       text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Baru: siapa yang membayar, dan tagihan (manual_payments) mana yang dilunasi.
ALTER TABLE midtrans_payments ADD COLUMN IF NOT EXISTS user_id           text;
ALTER TABLE midtrans_payments ADD COLUMN IF NOT EXISTS manual_payment_id integer;

CREATE INDEX IF NOT EXISTS midtrans_payments_manual_payment_idx ON midtrans_payments (manual_payment_id);
CREATE INDEX IF NOT EXISTS midtrans_payments_user_idx           ON midtrans_payments (user_id);

-- Kunci Data API (lihat 0001_setup.sql): RLS aktif, tanpa policy. Semua akses
-- lewat Express API dengan koneksi server.
ALTER TABLE midtrans_payments ENABLE ROW LEVEL SECURITY;

-- Order lama (API sebelumnya) tidak terikat ke tagihan mana pun; tidak
-- pernah boleh mengaktifkan layanan. Biarkan sebagai riwayat saja.
COMMENT ON TABLE midtrans_payments IS
  'Ledger Midtrans Snap. Baris dengan manual_payment_id NULL adalah data lama dan tidak pernah mengaktifkan apa pun.';
