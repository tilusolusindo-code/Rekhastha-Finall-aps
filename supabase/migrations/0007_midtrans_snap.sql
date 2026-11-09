-- Migration 0007: Midtrans Snap integration
-- Jalankan di Supabase SQL Editor sebelum deploy

-- Tambah kolom midtrans_order_id ke subscription_orders
ALTER TABLE subscription_orders
  ADD COLUMN IF NOT EXISTS midtrans_order_id text,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

CREATE INDEX IF NOT EXISTS sub_orders_midtrans_idx ON subscription_orders(midtrans_order_id);

-- Tambah tipe notifikasi baru
COMMENT ON TABLE subscription_orders IS 'Order langganan Rekhastha Bisnis — mendukung Midtrans Snap';
