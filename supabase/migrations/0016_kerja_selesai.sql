-- Penanda "pekerjaan selesai" yang diisi server saat hari kerja terakhir lengkap (scan masuk + pulang).
-- Terpisah dari status "selesai" (yang berarti upah sudah disetujui/dicairkan) agar tombol
-- pencairan upah pemberi kerja tidak terblokir.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS work_completed_at timestamptz;

-- Pulihkan data lama: lamaran "diterima" yang jumlah hari kerjanya (masuk + pulang lengkap)
-- sudah memenuhi jumlah_hari lowongan, tapi masih tampak aktif.
WITH days AS (
  SELECT job_id, worker_id, scan_date, max(at) FILTER (WHERE kind = 'pulang') AS out_at
  FROM attendance
  GROUP BY job_id, worker_id, scan_date
  HAVING bool_or(kind = 'masuk') AND bool_or(kind = 'pulang')
), done AS (
  SELECT job_id, worker_id, count(*) AS n, max(out_at) AS last_out
  FROM days
  GROUP BY job_id, worker_id
)
UPDATE applications a
SET work_completed_at = done.last_out
FROM done
JOIN gigs g ON g.id = done.job_id
WHERE a.job_id = done.job_id
  AND a.worker_id = done.worker_id
  AND a.status = 'diterima'
  AND a.work_completed_at IS NULL
  AND done.n >= GREATEST(COALESCE(g.jumlah_hari, 1), 1);
