-- Migration 0013: catatan pengembalian dana escrow (refund otomatis & manual admin)
CREATE TABLE IF NOT EXISTS escrow_refunds (
  id          serial PRIMARY KEY,
  gig_id      bigint NOT NULL UNIQUE,
  employer_id text NOT NULL,
  amount      integer NOT NULL,
  source      text NOT NULL,
  reason      text NOT NULL DEFAULT '',
  status      text NOT NULL DEFAULT 'pending',
  created_at  timestamptz NOT NULL DEFAULT now(),
  paid_at     timestamptz,
  paid_note   text
);
CREATE INDEX IF NOT EXISTS escrow_refunds_status_idx ON escrow_refunds (status);

-- Hanya diakses lewat API server (service role); RLS aktif tanpa kebijakan publik.
ALTER TABLE escrow_refunds ENABLE ROW LEVEL SECURITY;
