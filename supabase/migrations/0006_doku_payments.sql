-- Migration 0006: DOKU Payment Gateway
-- Jalankan di Supabase SQL Editor sebelum deploy

CREATE TABLE IF NOT EXISTS doku_payments (
  id                    serial PRIMARY KEY,
  order_id              text NOT NULL UNIQUE,
  subscription_order_id integer,
  company_id            text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount                integer NOT NULL,
  status                text NOT NULL DEFAULT 'pending',
  checkout_url          text,
  doku_token            text,
  request_id            text,
  transaction_status    text,
  payment_channel       text,
  notified_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS doku_payments_company_idx  ON doku_payments(company_id);
CREATE INDEX IF NOT EXISTS doku_payments_status_idx   ON doku_payments(status);
CREATE INDEX IF NOT EXISTS doku_payments_order_idx    ON doku_payments(order_id);

-- RLS
ALTER TABLE doku_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company_own_doku_payments" ON doku_payments;
CREATE POLICY "company_own_doku_payments" ON doku_payments
  FOR SELECT USING (company_id = auth.uid()::text);

-- Webhook DOKU insert via service-role key (dari API server), tidak perlu RLS policy insert

COMMENT ON TABLE doku_payments IS 'Transaksi DOKU Payment Gateway untuk langganan Rekhastha Bisnis';
