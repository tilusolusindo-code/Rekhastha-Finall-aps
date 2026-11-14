import { useEffect, useMemo, useState } from "react";
import {
  CircleHelp, X, ChevronDown, Search, UserCheck, Radar, Send, MessageSquare,
  QrCode, Wallet, ShieldCheck, Megaphone, CreditCard, Users, BadgeCheck, Building2, Lightbulb,
} from "lucide-react";

export type GuideRole = "pekerja" | "perusahaan";

interface GuideTopic {
  id: string;
  icon: React.ReactNode;
  title: string;
  summary: string;
  steps: string[];
  tips?: string[];
}

const ic = "w-5 h-5";

const WORKER_TOPICS: GuideTopic[] = [
  {
    id: "w-profil",
    icon: <UserCheck className={ic} />,
    title: "Lengkapi profil dan verifikasi",
    summary: "Profil lengkap wajib sebelum Anda bisa melamar.",
    steps: [
      "Tekan Daftar & Verifikasi atau Lengkapi Profil di bagian atas layar.",
      "Langkah Identitas: isi nama sesuai KTP, NIK 16 digit, tempat dan tanggal lahir, jenis kelamin, serta WhatsApp aktif.",
      "Langkah Pajak & Bank: isi NPWP (atau centang Saya belum memiliki NPWP), lalu bank atau e-wallet, nomor rekening, dan nama pemilik.",
      "Langkah Dokumen: unggah Foto KTP dan Selfie Pegang KTP (JPG atau PNG, maksimal 5 MB per foto).",
      "Tim Rekhastha meninjau dokumen Anda. Pantau statusnya di Profil > Data Diri > Verifikasi Identitas (KYC).",
      "Di Profil, tekan Edit Profil untuk mengubah nama dan WhatsApp. Tekan ikon kamera pada foto untuk mengganti foto profil.",
    ],
    tips: [
      "Nomor rekening harus atas nama Anda sendiri. Upah dikirim ke rekening ini.",
      "Unggah CV dan portofolio (PDF, maksimal 10 MB) di Profil agar terpakai otomatis saat melamar.",
    ],
  },
  {
    id: "w-radar",
    icon: <Radar className={ic} />,
    title: "Nyalakan radar dan terima Broadcast Instan",
    summary: "Radar membuat Anda menerima lowongan mendesak lengkap dengan bunyi.",
    steps: [
      "Izinkan notifikasi dan akses lokasi saat browser memintanya.",
      "Nyalakan Status Radar Mencari Kerja. Radar mati sendiri bila akses lokasi terputus.",
      "Saat ada Broadcast Instan, layar penuh muncul dengan bunyi. Tekan Terima Kerja (Buka Radar) untuk melihat detail, atau Lewati.",
      "Menerima alarm belum berarti melamar. Tekan Lamar Pekerjaan Ini untuk mengirim lamaran.",
    ],
    tips: ["Posting Reguler tidak berbunyi. Lowongan itu muncul di tab Jadwal."],
  },
  {
    id: "w-lamar",
    icon: <Send className={ic} />,
    title: "Cari dan lamar lowongan",
    summary: "Tab Daftar, Radar, Jadwal, dan Lamar ada di bagian atas halaman Radar.",
    steps: [
      "Daftar menampilkan kartu lowongan. Radar menampilkan peta: pin hijau untuk Broadcast Instan, pin ungu untuk lowongan lain.",
      "Jadwal berisi lowongan Posting Reguler dengan filter urutan, jarak, kategori, tipe pembayaran, dan kisaran upah.",
      "Buka lowongan dan baca deskripsi, persyaratan pakaian, serta Kalkulasi Penghasilan Bersih.",
      "Tekan Lamar Pekerjaan Ini. Untuk lowongan Reguler, isi Formulir Lamaran (jawaban pertanyaan, pengalaman, berkas) lalu tekan Kirim Lamaran.",
      "Setelah muncul Lamaran Terkirim!, buka tab Lamar untuk memantau status: Baru, Ditinjau, Diterima, Ditolak, atau Selesai.",
    ],
    tips: ["Lowongan mencurigakan? Tekan Laporkan Lowongan Mencurigakan di halaman detail."],
  },
  {
    id: "w-chat",
    icon: <MessageSquare className={ic} />,
    title: "Chat dengan pemberi kerja",
    summary: "Chat terbuka setelah lamaran Anda Diterima.",
    steps: [
      "Buka tab Chat atau tekan tombol Chat pada lamaran yang Diterima.",
      "Untuk lowongan Reguler, ajukan atau setujui upah lewat Ajukan Tawaran Upah Baru. Setelah sepakat, muncul Kesepakatan Upah Terkunci.",
      "Lowongan Broadcast Instan memakai upah tetap tanpa tawar-menawar.",
      "Anda bisa mengirim foto atau PDF (maksimal 5 MB).",
    ],
    tips: [
      "Pesan berisi nomor kontak atau ajakan membayar di luar aplikasi akan diblokir. Setelah tiga pesan diblokir, chat dijeda sementara.",
    ],
  },
  {
    id: "w-presensi",
    icon: <QrCode className={ic} />,
    title: "Presensi masuk dan pulang dengan QR",
    summary: "Presensi memakai QR dari pemberi kerja dan lokasi GPS Anda.",
    steps: [
      "Datang ke lokasi kerja dan minta pemberi kerja menampilkan QR presensi.",
      "Tekan Clock-In, lalu Scan QR Presensi Masuk. Tunggu pesan Presensi Masuk Berhasil!.",
      "Setelah selesai bekerja, tekan Clock-Out, lalu Scan QR Presensi Pulang.",
      "Pemberi kerja punya 24 jam untuk memvalidasi. Bila tidak ada sengketa, dana dicairkan otomatis.",
    ],
    tips: [
      "Anda harus berada dalam radius presensi, umumnya 500 meter dari lokasi.",
      "Bila GPS kurang akurat, pindah ke area terbuka lalu scan lagi.",
      "QR berlaku 3 menit dan sekali pakai. Minta QR baru bila kedaluwarsa.",
    ],
  },
  {
    id: "w-upah",
    icon: <Wallet className={ic} />,
    title: "Upah, slip gaji, dan pencairan",
    summary: "Anda menerima 100% upah di lowongan. Biaya admin dibayar pemberi kerja.",
    steps: [
      "Buka Profil > E-Wallet untuk melihat Saldo Tercatat dan Riwayat Mutasi.",
      "Tekan Minta transfer untuk mencairkan saldo ke rekening di profil. Admin memproses transfer secara manual, jadi statusnya Menunggu transfer admin lebih dulu.",
      "Hanya satu permintaan pencairan yang boleh menunggu pada satu waktu.",
      "Pencairan diblokir selama ada sengketa aktif.",
      "Setelah pekerjaan selesai, tekan Slip Gaji pada banner pekerjaan untuk melihat rincian.",
    ],
  },
  {
    id: "w-reputasi",
    icon: <ShieldCheck className={ic} />,
    title: "Rating, reputasi, dan keselamatan",
    summary: "Jaga reputasi agar tetap bisa melamar.",
    steps: [
      "Setelah pekerjaan selesai, beri bintang 1 sampai 5 untuk perusahaan.",
      "Poin reputasi dimulai dari 100. Membatalkan pekerjaan yang sudah diterima mengurangi 20 poin. Di bawah 50 poin, akun ditangguhkan.",
      "Saat ada pekerjaan aktif, tombol LAPOR DARURAT (SOS) mengirim laporan ke tim Rekhastha dan menampilkan panduan pertolongan pertama.",
    ],
    tips: ["Dalam keadaan darurat, hubungi juga layanan darurat setempat (112)."],
  },
];

const COMPANY_TOPICS: GuideTopic[] = [
  {
    id: "c-profil",
    icon: <Building2 className={ic} />,
    title: "Siapkan profil usaha",
    summary: "Profil yang rapi membuat pekerja lebih percaya.",
    steps: [
      "Buka Profil (nama Anda di navigasi), lalu tekan Edit Profil.",
      "Ubah nama, nomor WhatsApp, nama usaha, dan alamat.",
      "Tekan ikon kamera pada foto untuk mengganti foto profil. Foto ini tampil bagi pekerja di lamaran dan chat.",
    ],
  },
  {
    id: "c-posting",
    icon: <Megaphone className={ic} />,
    title: "Pasang lowongan",
    summary: "Pilih Broadcast Instan untuk kebutuhan hari ini atau Posting Reguler untuk kontrak terjadwal.",
    steps: [
      "Buka Beranda > Lowongan, lalu pilih mode: Broadcast Instan atau Posting Reguler.",
      "Isi nama posisi, kategori, tipe pembayaran, jumlah pekerja, upah, dan alamat penempatan (cari alamat, gunakan lokasi saat ini, atau klik peta).",
      "Broadcast Instan: tulis catatan singkat (maksimal 150 karakter). Tanggal kerja otomatis hari ini.",
      "Posting Reguler: isi tanggal mulai, jam kerja, durasi kontrak, dan deskripsi lengkap.",
      "Tambahkan pertanyaan dan berkas yang wajib dikirim pelamar bila perlu.",
      "Periksa Rincian Biaya Posting, lalu tekan Buat Lowongan & Bayar.",
    ],
    tips: [
      "Upah pekerja dan biaya admin ditampilkan terpisah. Pekerja menerima 100% upah.",
      "Biaya posting ditampilkan Diwaive bila akun Anda sedang masa uji coba atau berlangganan aktif.",
    ],
  },
  {
    id: "c-bayar",
    icon: <CreditCard className={ic} />,
    title: "Bayar lowongan",
    summary: "Lowongan baru tayang setelah pembayaran terkonfirmasi.",
    steps: [
      "Setelah Buat Lowongan & Bayar, jendela Bayar via Midtrans terbuka. Pilih metode yang tersedia, misalnya virtual account bank, QRIS, kartu kredit, Indomaret, atau Alfamart.",
      "Selesaikan pembayaran. Setelah berhasil, lowongan tayang dan dana upah terkunci di escrow.",
      "Belum sempat membayar? Lowongan masuk daftar Lowongan menunggu pembayaran di Beranda. Tekan Bayar untuk melanjutkan.",
      "Tombol Pembayaran di kanan bawah membuka panel Pembayaran Manual untuk melihat tagihan dan statusnya.",
    ],
    tips: ["Lowongan yang belum dibayar tidak terlihat oleh pekerja."],
  },
  {
    id: "c-pelamar",
    icon: <Users className={ic} />,
    title: "Pilih dan kelola pelamar",
    summary: "Pelamar masuk lewat ikon lonceng (Lamaran Masuk) dan kartu lowongan.",
    steps: [
      "Tekan ikon lonceng untuk membuka Lamaran Masuk, atau buka kartu lowongan untuk melihat daftar pelamar.",
      "Baca profil, jawaban pertanyaan, dan berkas pelamar. NIK dan NPWP ditampilkan tersamar.",
      "Tekan Terima, Tinjau, atau tombol X untuk menolak.",
      "Untuk lowongan Reguler, tekan Terima & Kunci Upah, lalu Kunci Sekarang untuk mengunci dana.",
      "Setelah diterima, tekan Buka Chat dengan Pekerja untuk berkoordinasi.",
    ],
    tips: [
      "Tiga pelamar pertama pada kartu lowongan gratis. Pelamar berikutnya membutuhkan Paket Bulanan.",
      "Beri rating setelah pekerjaan. Aktifkan Blacklist pekerja ini bila Anda tidak ingin pekerja itu melihat lowongan Anda lagi.",
    ],
  },
  {
    id: "c-presensi",
    icon: <QrCode className={ic} />,
    title: "QR presensi pekerja",
    summary: "Pekerja memindai QR Anda untuk presensi masuk dan pulang. Fitur ini butuh Rekhastha Bisnis aktif.",
    steps: [
      "Tekan Tampilkan QR Absensi pada lowongan yang dananya sudah terkunci, atau Presensi QR di tab Chat.",
      "Pilih cabang (opsional), lalu pilih Presensi Masuk atau Presensi Pulang.",
      "Tunjukkan QR kepada pekerja. QR sekali pakai dan kedaluwarsa dalam 3 menit. Tekan Perbarui QR bila perlu.",
      "Untuk usaha multi-lokasi, tambahkan cabang dari jendela QR (nama, alamat, lokasi, radius).",
    ],
    tips: ["Tanpa cabang, QR memakai titik lokasi lowongan dengan radius 500 meter."],
  },
  {
    id: "c-selesai",
    icon: <BadgeCheck className={ic} />,
    title: "Selesai, pencairan, dan sengketa",
    summary: "Pantau status lowongan dari Beranda > Lowongan.",
    steps: [
      "Setelah pekerja presensi pulang, Anda punya 24 jam untuk memvalidasi hasil kerja.",
      "Tidak ada keberatan? Dana dicairkan ke pekerja. Anda juga dapat menekan Selesai & Bayar Pekerja di Lamaran Masuk.",
      "Ada masalah? Tekan Ajukan Sengketa. Dana dibekukan sampai admin Rekhastha memutuskan.",
      "Lowongan yang sudah selesai atau dibatalkan pindah ke Riwayat Selesai.",
      "Membatalkan kontrak dalam 1 jam pertama setelah diterima dikenai kompensasi Rp20.000 untuk pekerja.",
    ],
  },
  {
    id: "c-bisnis",
    icon: <Lightbulb className={ic} />,
    title: "Rekhastha Bisnis",
    summary: "Langganan untuk alat manajemen pekerja.",
    steps: [
      "Buka tab Bisnis, pilih paket, lalu tekan Bayar. Pembayaran lewat Midtrans dan status Premium aktif diperbarui otomatis.",
      "Setelah aktif, QR Presensi GPS terbuka. Tombol Hitung Pajak dan Kelola Tim juga tersedia.",
      "Kelola Tim: undang akun yang sudah terdaftar dengan peran HR, Supervisor, atau Finance.",
    ],
  },
];

const GENERAL_TOPICS: GuideTopic[] = [
  {
    id: "g-akun",
    icon: <ShieldCheck className={ic} />,
    title: "Keamanan akun",
    summary: "Tips agar akun dan uang Anda aman.",
    steps: [
      "Kata sandi minimal 12 karakter. Lupa kata sandi? Tekan Lupa kata sandi? di halaman Masuk. Tautan reset berlaku 15 menit.",
      "Satu akun hanya punya satu peran: Pekerja atau Perusahaan. Peran dipilih saat mendaftar.",
      "Lakukan pembayaran dan komunikasi kerja hanya di dalam aplikasi.",
      "Baca Syarat & Ketentuan di halaman pendaftaran untuk aturan pembayaran, pembatalan, dan presensi.",
    ],
  },
];

const STORAGE_PREFIX = "rekhastha_guide_seen_v1:";

export function hasSeenGuide(userId: string): boolean {
  try { return localStorage.getItem(STORAGE_PREFIX + userId) === "1"; } catch { return true; }
}

function markSeen(userId: string) {
  try { localStorage.setItem(STORAGE_PREFIX + userId, "1"); } catch { /* storage tidak tersedia */ }
}

/** Tombol bulat "Panduan" yang membuka AppGuide. */
export function GuideButton({ onClick, className = "" }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Buka panduan penggunaan"
      data-testid="open-guide"
      data-tour="guide-button"
      className={`inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-50 active:scale-95 transition ${className}`}
    >
      <CircleHelp className="w-4 h-4" /> Panduan
    </button>
  );
}

interface AppGuideProps {
  open: boolean;
  role: GuideRole;
  userId: string;
  onClose: () => void;
  /** Bila diisi, tombol "Mulai Tur Interaktif" tampil di bagian bawah. */
  onStartTour?: () => void;
}

export default function AppGuide({ open, role, userId, onClose, onStartTour }: AppGuideProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const topics = useMemo(
    () => [...(role === "perusahaan" ? COMPANY_TOPICS : WORKER_TOPICS), ...GENERAL_TOPICS],
    [role],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return topics;
    return topics.filter((t) =>
      [t.title, t.summary, ...t.steps, ...(t.tips ?? [])].join(" ").toLowerCase().includes(q),
    );
  }, [topics, query]);

  useEffect(() => {
    if (!open) return;
    setOpenId(topics[0]?.id ?? null);
    setQuery("");
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, topics]);

  function close() {
    markSeen(userId);
    onClose();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
         role="dialog" aria-modal="true" aria-label="Panduan penggunaan Rekhastha" data-testid="app-guide"
         onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="flex max-h-[92vh] w-full sm:max-w-xl flex-col overflow-hidden rounded-t-3xl sm:rounded-3xl bg-white shadow-2xl">
        <div className="shrink-0 bg-gradient-to-br from-emerald-700 to-emerald-600 px-5 pt-5 pb-4 text-white">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-emerald-100">
                {role === "perusahaan" ? "Untuk Perusahaan" : "Untuk Pekerja"}
              </p>
              <h2 className="text-lg font-black">Panduan Penggunaan</h2>
              <p className="mt-0.5 text-xs text-emerald-50">Langkah singkat dari daftar sampai upah cair.</p>
            </div>
            <button type="button" onClick={close} aria-label="Tutup panduan" className="rounded-full p-1.5 text-white/80 hover:bg-white/10">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari, misalnya: presensi, bayar, lamar"
              aria-label="Cari panduan"
              className="w-full rounded-xl border-0 bg-white py-2.5 pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-300"
            />
          </div>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto bg-gray-50 p-3">
          {filtered.length === 0 && (
            <p className="py-10 text-center text-sm text-gray-500">Tidak ada topik yang cocok. Coba kata lain.</p>
          )}
          {filtered.map((t) => {
            const expanded = query.trim() ? true : openId === t.id;
            return (
              <section key={t.id} className="overflow-hidden rounded-2xl border border-gray-100 bg-white">
                <button
                  type="button"
                  onClick={() => setOpenId(expanded && !query.trim() ? null : t.id)}
                  aria-expanded={expanded}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">{t.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-black text-gray-900">{t.title}</span>
                    <span className="block text-xs text-gray-500">{t.summary}</span>
                  </span>
                  <ChevronDown className={`h-4 w-4 shrink-0 text-gray-500 transition-transform ${expanded ? "rotate-180" : ""}`} />
                </button>
                {expanded && (
                  <div className="space-y-3 border-t border-gray-100 px-4 pb-4 pt-3">
                    <ol className="space-y-2">
                      {t.steps.map((s, i) => (
                        <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed text-gray-700">
                          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[12px] font-black text-white">{i + 1}</span>
                          <span>{s}</span>
                        </li>
                      ))}
                    </ol>
                    {t.tips && t.tips.length > 0 && (
                      <div className="space-y-1 rounded-xl border border-amber-100 bg-amber-50 p-3">
                        <p className="text-[12px] font-black uppercase tracking-wide text-amber-800">Tips</p>
                        {t.tips.map((tip, i) => (
                          <p key={i} className="text-xs leading-relaxed text-amber-900">{tip}</p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>

        <div className="shrink-0 border-t border-gray-100 bg-white p-3">
          {onStartTour && (
            <button type="button" onClick={() => { markSeen(userId); onStartTour(); }}
              className="mb-2 w-full rounded-xl border border-emerald-200 bg-emerald-50 py-3 text-sm font-black text-emerald-700 active:scale-[0.98] transition">
              Mulai Tur Interaktif
            </button>
          )}
          <button type="button" onClick={close}
            className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-black text-white active:scale-[0.98] transition">
            Saya Paham
          </button>
          <p className="mt-2 text-center text-[12px] text-gray-500">Buka lagi kapan saja lewat tombol Panduan.</p>
        </div>
      </div>
    </div>
  );
}
