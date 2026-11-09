# Threat Model

**Terakhir ditinjau:** 23 Oktober 2026

## Project Overview

Rekhastha by Tilu Saudara Solusindo adalah marketplace kerja harian untuk pekerja dan pemberi kerja di seluruh Indonesia. Frontend React/Vite berkomunikasi dengan API Express 5 dan PostgreSQL/Drizzle. Akun memakai email/password dan cookie sesi; aplikasi juga memiliki WebSocket, pemeriksaan KYC, dokumen lamaran, dan alur transfer manual yang diverifikasi admin.

## Assets

- **Identitas dan data pribadi:** nama, email, nomor WhatsApp, NIK/KTP, selfie KTP, NPWP, dan rincian rekening. Kebocoran dapat memicu penipuan identitas atau finansial.
- **File pengguna:** lampiran chat, KTP/selfie, CV, dan portofolio. Produksi menyimpan unggahan privat di App Storage; unduhan tetap melalui pemeriksaan sesi dan kepemilikan. File lokal hanya untuk development dan kompatibilitas lampiran lama.
- **Akun dan sesi:** hash kata sandi, cookie sesi, status verifikasi, dan otorisasi pekerja/perusahaan/admin.
- **Data transaksi:** nilai upah, biaya layanan, bukti dan status transfer manual, status escrow internal, pengembalian, serta pembayaran kepada pekerja.
- **Data pekerjaan dan lamaran:** lokasi/jadwal kerja, kebutuhan tenaga kerja, riwayat lamaran, dan komunikasi antarpengguna.
- **Akses admin dan rahasia layanan:** kredensial admin, koneksi basis data, konfigurasi sesi, dan kredensial penyedia eksternal.

## Trust Boundaries

- **Browser ke API:** seluruh input browser tidak tepercaya. Identitas dan peran harus diturunkan serta diperiksa di sisi server.
- **API ke PostgreSQL:** API memiliki akses ke data akun, identitas, lamaran, dan transaksi. Query dan perubahan saldo/status harus dibatasi server-side serta tercatat.
- **API ke penyimpanan file:** API mengunggah file privat ke App Storage dan membuat URL sementara hanya setelah memeriksa pemilik atau peserta yang berwenang. File lokal tidak termasuk dalam image deployment.
- **Publik ke pengguna terautentikasi dan admin:** rute, file, serta operasi keuangan harus membedakan sesi valid, kepemilikan data, dan hak admin.
- **Aplikasi ke layanan eksternal:** transfer bank/WhatsApp dan penyedia pembayaran berada di luar kendali langsung API; konfirmasi manual memerlukan rekonsiliasi dan jejak audit.
- **Development ke production:** hasil dev tidak membuktikan rahasia, basis data, domain, penyimpanan, dan konfigurasi deployment produksi sudah benar.

## Scan Anchors

- Entry point frontend: `artifacts/jakarta-gig-finder`; entry point API: `artifacts/api-server`, dipetakan di manifest masing-masing.
- Batas sesi dan identitas: `artifacts/api-server/src/lib/auth.ts`, `src/routes/auth.ts`, serta middleware/rute admin.
- File berisiko tinggi: `artifacts/api-server/src/app.ts` dan `src/lib/upload.ts`; perhatikan perbedaan antara unggahan lokal dan `src/lib/private-application-storage.ts`.
- Pembayaran dan perubahan status finansial: `artifacts/api-server/src/routes/manual-finance.ts`; endpoint Midtrans saat ini mengembalikan 410.
- `artifacts/rekhastha-gig-finder-film` dan `artifacts/mockup-sandbox` adalah artefak terpisah; jangan anggap keduanya sebagai permukaan API produksi tanpa bukti bahwa layanan tersebut terhubung.

## Threat Categories

### Spoofing

Penyerang dapat mencoba mengambil alih akun pekerja/perusahaan, menyalahgunakan sesi yang dicuri, atau menebak kredensial lewat login publik. Cookie sesi menggunakan `httpOnly` dan `sameSite=lax`, sesi berlaku 30 hari, login pengguna/admin menyimpan lockout di PostgreSQL, dan hash kata sandi menggunakan bcrypt dengan cost 12 serta panjang minimum 12 karakter. Pendaftaran pengguna belum memiliki pembatasan frekuensi; throttling login pengguna juga harus memastikan alamat IP berasal dari proxy tepercaya.

**Jaminan wajib:** setiap endpoint privat harus memvalidasi sesi dan peran server-side; percobaan login dan pendaftaran harus dibatasi dengan identitas klien yang tidak dapat dipalsukan; kredensial harus memenuhi standar kekuatan yang sesuai; tombol provider hanya ditampilkan bila autentikasi provider benar-benar aktif.

### Tampering

Pelanggan yang tidak tepercaya dapat mengubah ID pekerjaan/lamaran, pemilik objek, nominal, atau status transaksi pada request. Harga, upah, kepemilikan, dan transisi escrow harus ditentukan server, bukan dipercaya dari browser. Pembayaran manual yang dikonfirmasi admin perlu dicocokkan dengan pembayar, nominal, dan target transaksi.

**Jaminan wajib:** validasi skema dan izin kepemilikan diterapkan pada setiap mutasi; kalkulasi keuangan dilakukan server-side dalam transaksi basis data; perubahan status pembayaran/escrow dicatat dan tidak dapat diulang atau diterapkan ke target yang berbeda.

### Repudiation

Transfer manual dan keputusan admin dapat diperselisihkan bila referensi bukti, pemeriksa, waktu, atau alasan tidak dicatat. Log admin yang ada membantu, tetapi perlu dipastikan seluruh perubahan finansial dan sengketa tercakup serta dapat direkonsiliasi dengan bukti transfer di luar aplikasi.

**Jaminan wajib:** setiap keputusan finansial menyimpan pelaku, waktu, objek, hasil, dan alasan; prosedur rekonsiliasi/pengembalian memiliki bukti yang dapat diaudit.

### Information Disclosure

**Temuan audit awal, dimitigasi pada source code:** API sebelumnya memasang `express.static(UPLOAD_ROOT)` pada `/api/uploads` tanpa pemeriksaan sesi; mount publik itu sudah dihapus. Rute privat membatasi KYC ke pemilik/admin, dokumen ke pemilik atau perusahaan pada lamaran terkait, dan chat ke peserta percakapan yang diterima. Lampiran lokal lama telah disalin ke bucket privat; nama URL lama tetap dipetakan ke objek privat, sementara file lokal dikecualikan dari image deployment. Unggahan KYC, dokumen profil, dan chat baru di produksi memakai object storage dengan URL unduhan bertanda tangan berumur pendek. Perubahan ini belum diuji melalui deployment produksi.

**Jaminan wajib:** KYC, CV/portofolio, dan lampiran privat tidak pernah dilayani sebagai file publik; setiap unduhan memerlukan autentikasi serta pemeriksaan pemilik/admin atau peserta percakapan. Akses lintas pengguna harus diuji tanpa autentikasi dan sebagai akun lain, serta rute admin KYC harus diuji dengan sesi admin valid. Kebijakan privasi harus menjelaskan pengumpulan, tujuan, retensi, penerima, dan cara pengguna mengajukan permintaan terkait datanya.

### Denial of Service

Unggahan memiliki batas ukuran dan tipe, API membatasi ukuran JSON/form, dan server membatasi ukuran frame WebSocket. Hasil pemindaian terakhir telah membersihkan temuan kritis dan tinggi pada dependensi; hasil berikutnya tetap perlu dipantau. Pendaftaran akun masih membutuhkan pembatasan frekuensi. App Storage diperlukan untuk ketahanan lampiran lintas restart dan instance.

**Jaminan wajib:** dependensi runtime tetap diperbarui ke versi yang telah ditambal; audit produksi dijalankan ulang; login dan endpoint publik dibatasi; pengunggahan memiliki batas ukuran, frekuensi, dan pembersihan berkas gagal yang aman.

### Elevation of Privilege

Perbedaan pekerja, perusahaan, dan admin menentukan akses ke data pribadi, review KYC, dan uang. Pengguna tidak boleh dapat mengganti ID pada URL/body untuk membaca atau mengubah akun, file, lamaran, ataupun transaksi pengguna lain. Akses admin harus diperiksa di API, bukan hanya disembunyikan di UI.

**Jaminan wajib:** semua rute sensitif memeriksa peran dan kepemilikan objek di server; IDOR diuji untuk setiap kelompok rute privat; operasi admin dan payout memerlukan otorisasi admin teruji serta log audit.
