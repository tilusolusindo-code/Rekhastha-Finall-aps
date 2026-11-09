-- Migration 0009: buku besar transaksi Midtrans (midtrans_payments)
-- Webhook memakai tabel ini sebagai sumber kebenaran (target + nominal),
-- bukan field di body notifikasi. Jalankan di Supabase SQL Editor sebelum deploy.

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
CREATE INDEX IF NOT EXISTS midtrans_payments_job_idx ON midtrans_payments(job_type, job_id);
ALTER TABLE midtrans_payments ENABLE ROW LEVEL SECURITY;
