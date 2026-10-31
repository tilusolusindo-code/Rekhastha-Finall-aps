# Audit Kesiapan Pemasaran Tahap Awal

**Tanggal audit:** 23 Oktober 2026
**Cakupan:** source code dan workflow development Rekhastha/Jakarta Gig Finder, konfigurasi artifact, pemindaian keamanan, build/test, serta halaman yang terlihat tanpa login. Ini bukan pentest independen, tinjauan hukum, atau verifikasi produksi.

## Keputusan

**Belum siap dipasarkan secara publik.** Belum ada deployment produksi yang terdaftar. Source code kini memiliki landing page, autentikasi yang diperketat, klaim perlindungan yang lebih transparan, dan hasil audit dependensi produksi yang bersih. Blocker yang masih terbuka adalah Kebijakan Privasi/syarat final, prosedur pembayaran manual dan dukungan, aturan denda keterlambatan, serta verifikasi pada staging/produksi.

Jangan membuka pendaftaran publik sebelum blocker yang tersisa ditutup. Audit ini tidak mengubah alur uang atau data produksi dan tidak melakukan deployment.

### Pembaruan keamanan, server, dan penyimpanan — 23 Oktober 2026

- Object Storage privat telah dikonfigurasi untuk environment produksi. Empat lampiran chat lokal lama disalin ke bucket privat dan keberadaannya diverifikasi; file sumber tidak dihapus. File lokal dikecualikan dari image deployment.
- Unggahan KYC, CV/portofolio, dan chat baru di produksi disimpan ke Object Storage. API hanya memberikan unduhan setelah autentikasi dan pemeriksaan kepemilikan/peserta, lalu mengarahkan ke URL HTTPS bertanda tangan pada `storage.googleapis.com` yang kedaluwarsa dalam lima menit.
- API menghapus CORS terbuka, menambahkan header keamanan, membatasi body JSON/form, menguatkan verifikasi asal WebSocket, menonaktifkan kompresi WebSocket, dan membatasi ukuran pesannya. Hash password baru memakai bcrypt cost 12.
- Pemindaian lengkap: **0 critical, 0 high, 1 moderate** pada dependensi di seluruh workspace. Temuan moderate ada pada `postcss-selector-parser` 6.0.10, sebagai alat build frontend; `pnpm audit --prod` melaporkan bersih. SAST memiliki satu temuan redirect sedang yang ditinjau: tujuan redirect dibatasi ke HTTPS `storage.googleapis.com`. HoundDog tidak menemukan temuan.
- Typecheck API dan web lulus; 24 tes API lulus; pemeriksaan escrow dan konsistensi biaya lulus. Typecheck seluruh workspace masih gagal pada artefak film promosi yang terpisah.
- Tidak ada deployment aktif, sehingga perilaku di produksi dan proses migrasi skema database belum diuji lewat rilis nyata. Pendaftaran publik tetap tertahan oleh blocker hukum, operasi pembayaran, dan proses dukungan pada audit ini.

## Blocker sebelum publikasi

### P0 — File identitas dan unggahan dapat diakses tanpa login (diperbaiki pada source code)

Saat audit awal, `artifacts/api-server/src/app.ts` memasang direktori unggahan melalui `express.static` pada `/api/uploads` tanpa autentikasi. Pengujian HEAD tanpa login pada file unggahan menghasilkan HTTP 200. Perubahan saat ini menghapus mount publik dan menggunakan rute privat yang memeriksa kepemilikan KYC/CV atau hak admin/peserta chat. Dokumen lamaran hanya dapat diambil oleh pemilik atau perusahaan pada lamaran terkait.

**Dampak temuan awal:** siapa pun yang memperoleh URL dapat mengambil lampiran; path acak tidak memberikan kerahasiaan. Ini mencakup kategori data yang berpotensi sangat sensitif, seperti foto KTP/selfie dan CV.

**Status:** kontrol akses dan tes untuk akses anonim/lintas akun ditambahkan pada source code. URL chat lama tetap didukung, tetapi aksesnya ditentukan dari percakapan paling awal yang mencatat URL tersebut. Sebelum rilis, jalankan tes dan smoke test pada staging/produksi, pastikan penyimpanan file deployment sama, dan tinjau file lama yang mungkin pernah diakses publik; perubahan kode tidak dapat membatalkan salinan yang sudah diunduh.

### P0 — Kerentanan pada dependensi produksi

Temuan audit dependensi produksi pada pemeriksaan awal telah ditambal melalui pembaruan lockfile, Multer, dan override dependensi transitif.

**Status saat audit ini dilanjutkan:** `pnpm audit --prod` melaporkan tidak ada kerentanan yang diketahui. Ulangi audit sebelum deployment produksi dan setelah perubahan dependensi berikutnya. Hasil ini bukan jaminan bahwa aplikasi bebas seluruh risiko keamanan.

### P0 — Informasi privasi dan klaim perlindungan belum layak dipublikasikan

Formulir pendaftaran kini menjelaskan bahwa dokumen hukum belum final dan pendaftaran publik belum siap. Namun, Kebijakan Privasi tersendiri masih belum tersedia. Produk meminta atau dapat memproses NIK/KTP, selfie, NPWP, detail rekening, dokumen lamaran, chat, dan data lokasi presensi; pengguna perlu mendapat penjelasan tentang tujuan, retensi, akses, pembagian, serta cara meminta penghapusan/koreksi.

Klaim KYC biometrik otomatis, BPJS/asuransi aktif, arbitrase mengikat, imunitas hukum, “escrow terjamin”, dan daftar hitam permanen telah diganti atau dihapus dari teks pengguna. Verifikasi identitas dijelaskan sebagai tinjauan tim; syarat di aplikasi kini secara eksplisit masih berupa draf. Perubahan ini mengurangi salah representasi, tetapi bukan tinjauan hukum.

**Sebelum rilis:** terbitkan Kebijakan Privasi yang dapat dibuka; finalisasi syarat dan persetujuan; minta penasihat hukum Indonesia meninjau data pribadi, hubungan kerja, pembayaran, sengketa, BPJS/asuransi, dan pengungkapan data. Konfirmasikan siapa yang menerima, menyimpan, merekonsiliasi, dan membayarkan dana.

Aturan keterlambatan juga belum siap diterapkan: kode saat ini mengurangi saldo dan mencatat denda Rp15.000 hanya pada state halaman, bukan sebagai transaksi server yang persisten. Jangan menyajikan atau mengenakan denda ini sebagai transaksi nyata sebelum dasar kebijakan dan pencatatan server disepakati serta diuji.

## Siap secara teknis, dengan syarat

### Halaman publik dan autentikasi

- Pengunjung tanpa login kini melihat landing page berbahasa Indonesia dengan penjelasan untuk pemberi kerja dan pencari kerja. Tombolnya membuka jalur daftar/masuk yang sudah ada.
- Metadata memakai merek Rekhastha dan deskripsi produk; `robots.txt` memblokir `/admin`. `/sitemap.xml` masih membalas HTML aplikasi, dan canonical URL belum dapat ditetapkan sebelum domain produksi diketahui.
- Angka pengguna tanpa sumber telah dihapus dari layar autentikasi. Tombol Google hanya ditampilkan jika OAuth dikonfigurasi; pada environment ini API melaporkan `googleEnabled: false`.
- Pendaftaran akun baru mewajibkan password minimal 12 karakter; akun lama tetap dapat login dengan kata sandi sebelumnya. Percobaan login dibatasi secara persisten per alamat IP, 5 percobaan dalam 5 menit.
- Materi presensi, chat, profil, dan catatan pembayaran tidak lagi menjanjikan BPJS/asuransi atau jaminan escrow yang belum diverifikasi. Syarat hukum final masih menjadi blocker.

### Pembayaran, escrow, dan operasi

Alur posting memakai transfer manual dan review admin; pembayaran otomatis tidak aktif. Pengguna mengirim bukti pembayaran melalui alur manual yang tersedia, lalu admin memverifikasi. Tombol pada alur ini tidak memindahkan uang dengan sendirinya.

Pilot belum layak dibuka sebelum ada petugas, SLA aktivasi dan payout, rekonsiliasi, proses pengembalian/sengketa, dan kanal bantuan bisnis yang terkonfirmasi. Kode status “escrow” tidak membuktikan dana ditahan pada rekening kustodian atau skema escrow yang sah; pastikan mekanisme tersebut dengan penasihat hukum/keuangan sebelum membuat klaim.

## Hasil verifikasi

- **Status deployment:** tidak ada deployment produksi aktif pada saat audit.
- **Audit dependensi produksi:** `pnpm audit --prod` tidak menemukan kerentanan yang diketahui setelah pembaruan.
- **Typecheck frontend web dan API:** lulus secara terpisah setelah perubahan autentikasi dan copy UI.
- **Tes API:** 22 lulus pada 3 file tes (`admin.test.ts`, `pricing.test.ts`, `uploads.test.ts`). Tes rute unggahan mencakup akses anonim, pemilik/admin KYC, pemilik/pemberi kerja CV, peserta chat, URL chat lama, dan penolakan lintas percakapan.
- **Smoke test file privat:** permintaan HEAD anonim pada rute unggahan menghasilkan HTTP 401 setelah API dibangun ulang dan workflow dijalankan. Ini memverifikasi development, bukan deployment produksi.
- **Build API:** lulus saat workflow API dimulai ulang.
- **Build web dan film promosi:** lulus setelah menyediakan `PORT` dan `BASE_PATH` seperti yang diwajibkan oleh konfigurasi artifact.
- **Build frontend produksi:** lulus; bundle JavaScript utama 1,78 MB (501 KB gzip), melewati batas peringatan 500 KB. Vite juga memberi peringatan sourcemap yang tidak fatal pada dua komponen UI. Rencanakan optimasi pemuatan untuk perangkat/jaringan lambat.
- **Typecheck seluruh workspace:** gagal pada artefak film promosi (antara lain tipe DOM dan Framer Motion). Ini terpisah dari typecheck web/API yang lulus, tetapi membuat pemeriksaan monorepo belum bersih.
- **Halaman publik:** tampil pada preview desktop dan ponsel; ini memverifikasi development, bukan deployment produksi.
- **Pemeriksaan escrow dan konsistensi biaya:** workflow terkait selesai; tes escrow yang tercatat lulus.
- **SAST:** satu temuan medium tentang redirect ditinjau manual; tujuan redirect dibentuk ke URL Google yang tetap sehingga tampak sebagai false positive. **Pemindaian rahasia/privacy:** tidak ada temuan.

## Urutan kerja yang disarankan

1. Selesaikan Kebijakan Privasi, syarat, dasar penggunaan data, dan persetujuan dengan penasihat hukum Indonesia sebelum pendaftaran publik.
2. Putuskan kebijakan denda/blacklist dan pastikan setiap tindakan yang memengaruhi upah dicatat serta diuji di server.
3. Dokumentasikan transfer manual, rekonsiliasi, pencairan, pengembalian dana, SLA, sengketa, dan kanal bantuan yang benar-benar diawaki.
4. Verifikasi di staging bahwa KTP, selfie, CV, dan lampiran privat hanya dapat diakses pihak berwenang; tinjau paparan file lama.
5. Setelah domain produksi tersedia, tambahkan canonical URL dan sitemap, lalu smoke test daftar/login, lamaran, pembayaran, review admin, serta akses file.
6. Rapikan typecheck workspace dan uji deployment sebelum pemasaran publik.

**Perubahan pada audit ini:** landing page dan metadata publik ditambahkan; pendaftaran dan login diperketat; OAuth yang belum aktif disembunyikan; klaim perlindungan yang tidak didukung diganti; dependensi produksi diperbarui. Tidak ada deployment atau perubahan data produksi.
