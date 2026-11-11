# Perbaikan audit (di luar Midtrans/DOKU)

Patch ini terpisah dari perbaikan Midtrans. Keduanya menyentuh `vercel.json`
dan beberapa file yang sama — periksa konflik kalau memasang dua-duanya.

## K1 — Upah bisa dibayar melebihi escrow
- **`lib/wage-ledger.ts`** (baru): menghitung total upah yang SUDAH dikreditkan
  untuk satu lowongan, dijumlah dari tiga jalur (`gig_wage`, `remote_borongan`,
  `onsite_daily`). Dipakai di semua titik pembayaran di bawah supaya ada satu
  pagar anggaran yang konsisten lintas jalur.
- **`routes/applications.ts`** (`PATCH /applications/:id/status`): menerima
  pelamar sekarang dalam transaksi dengan baris lowongan terkunci, menolak
  kalau kuota sudah penuh, lowongan belum didanai/sedang refund-sengketa, atau
  pekerja belum KYC `verified`. Status terkunci setelah upah dikreditkan.
- **`routes/manual-finance.ts`** (`release-wage`): menambah pagar anggaran
  lintas jalur (`creditedWagesForJob`) dan mewajibkan KYC `verified` sebelum
  upah cair.
- **`lib/admin-finance.ts`** (`forcePayoutGig`): menambah pagar anggaran yang
  sama, dan sekarang bisa dipakai admin untuk melepas dana lowongan berstatus
  `disputed_active` (menutup T2 — sebelumnya Pusat Resolusi buntu).
- **`routes/borongan.ts`** (onsite checkout): menambah pagar anggaran lintas
  jalur, mewajibkan pelamar diterima dan KYC verified sebelum checkout.

## K2 — Mass-assignment di `POST /gigs`
- **`routes/gigs.ts`**: `createGigBody` diganti allowlist eksplisit (field
  deskriptif saja). Insert dan update sekarang menulis field satu per satu,
  tidak lagi menyebarkan `...parsed.data` ke query. `namaPerusahaan`,
  `nibPerusahaan`, `tipeAkun`, `isAgency` diambil dari profil akun di server,
  tidak lagi dari body klien.
- **S11 (edit setelah ada pelamar diterima)** ikut tertutup di endpoint yang
  sama: lokasi, tanggal, dan jam kerja terkunci begitu ada pelamar `diterima`.

## T1 — Upah harian onsite bisa dipicu sendiri / rusak untuk kuota > 1
- **`routes/borongan.ts`** (`/borongan/onsite/checkout`): progres sekarang
  dihitung PER PEKERJA dari `daily_payouts`, bukan dari `daysPaid` di level
  lowongan. `escrowStatus` jadi `released` hanya setelah SEMUA pekerja yang
  diterima menuntaskan kontraknya. Ditambah pagar anggaran lintas jalur dan
  pengecekan `escrowStatus` (lowongan yang sudah refund tidak lagi membayar).

## T2 — Borongan remote dan sengketa
- **`routes/borongan.ts`**: kolom baru `gigs.proof_submitted_by` menyimpan
  siapa yang mengirim bukti; `/borongan/remote/approve` membayar pengirim
  bukti itu, bukan "pelamar diterima pertama tanpa urutan". `/approve` dan
  `/reject` sekarang hanya berlaku saat `proofStatus === "submitted"`
  (mencegah reject sebelum ada bukti atau setelah dibayar). `forcePayoutGig`
  sekarang menerima status `disputed_active` sehingga admin bisa memutus untuk
  pekerja, tidak hanya refund.

## T3 — Aksi admin finansial tanpa guard
- **`routes/admin-ops.ts`**: `POST /admin/refund` dan
  `POST /admin/jobs/:id/refund` sekarang satu logika yang sama: menolak kalau
  upah sudah (sebagian) dikreditkan, berjalan dalam transaksi dengan baris
  terkunci, dan selalu mencatat `admin_logs` dengan alasan wajib diisi.
  `DELETE /admin/jobs/:id` menolak menghapus lowongan yang sudah didanai
  (`paymentStatus confirmed` dan belum di-refund) — mencegah
  `manual_payments` jadi yatim. ID job divalidasi dengan
  `Number.isSafeInteger` (`Number.isFinite` sebelumnya meloloskan `1.5`).

## T5 — Akun ditangguhkan tetap berfungsi
- **`lib/auth.ts`** (`getSessionUser`): sekarang memeriksa `suspended` di satu
  tempat yang dipakai SEMUA endpoint (bukan hanya `/auth/me` dan login).
- **`routes/admin.ts`** (`/admin/users/suspend`): saat admin menangguhkan,
  semua sesi pengguna itu langsung dicabut (`revokeAllUserSessions`), sama
  seperti reset password — bukan menunggu cookie kedaluwarsa 30 hari.

## T9 — Kamera diblokir
- **`vercel.json`**: `Permissions-Policy` diubah dari `camera=()` menjadi
  `camera=(self)` supaya `qr-scanner.tsx` (html5-qrcode) bisa membuka kamera
  di produksi.

## Migrasi
Jalankan `supabase/migrations/0008_audit_fixes.sql` (menambah kolom
`gigs.proof_submitted_by`). Kalau patch Midtrans juga dipasang dan sudah
memakai nomor `0008` untuk migrasinya sendiri, ganti salah satu nomor supaya
tidak bentrok — isinya independen satu sama lain.

## Yang BELUM disentuh patch ini
T4 (paywall pelamar / rekening terekspos), T6 (pre-hijacking akun Google),
T7 (hardening admin), semua temuan Sedang (S1–S13) dan Rendah (L1–L10), serta
konsolidasi dua salinan kode (S10). Prioritaskan T4 dan T6 berikutnya karena
menyangkut data pribadi dan pengambilalihan akun.

## Catatan pengujian
Semua perubahan hanya diverifikasi lewat pembacaan kode dan `tsc` tanpa
`node_modules` (sehingga error bawaan seputar tipe Node diabaikan). Belum
dijalankan `pnpm typecheck`, `pnpm test`, atau diuji di staging. Uji alur
berikut sebelum deploy:
- Posting lowongan, edit sebelum dan sesudah ada pelamar diterima.
- Terima pelamar sampai kuota penuh, lalu coba terima satu lagi (harus ditolak).
- Pekerja belum KYC mencoba diterima/menarik upah (harus ditolak).
- Checkout onsite harian untuk kuota > 2 pekerja sampai semua selesai.
- Submit bukti remote oleh satu pekerja, approve, lalu cek siapa yang dibayar.
- Admin refund lowongan yang upahnya sudah cair (harus ditolak).
- Admin menangguhkan akun yang sedang login di device lain (sesi harus putus).
- Buka pemindai QR presensi di produksi (kamera harus bisa dipakai).
