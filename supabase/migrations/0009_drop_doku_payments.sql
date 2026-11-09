-- Migration 0009: DOKU tidak dipakai lagi (digantikan Midtrans Snap).
-- JALANKAN MANUAL setelah memastikan tabel doku_payments memang tidak berisi data penting.
-- Tidak ada kode aplikasi yang membaca tabel ini lagi.
DROP TABLE IF EXISTS doku_payments;
