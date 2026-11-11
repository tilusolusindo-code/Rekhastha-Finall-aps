-- Migration 0008: perbaikan audit non-Midtrans/DOKU (K1, K2, T1, T2, T3, T5, T9)
-- Aman dijalankan ulang (IF NOT EXISTS). Jalankan di Supabase SQL Editor.

-- T2: menyimpan siapa yang mengirim bukti kerja borongan remote, supaya
-- /borongan/remote/approve membayar pengirim bukti, bukan "pelamar diterima pertama".
ALTER TABLE gigs ADD COLUMN IF NOT EXISTS proof_submitted_by text;

COMMENT ON COLUMN gigs.proof_submitted_by IS 'worker_id pengirim bukti kerja borongan remote yang sedang berjalan';
