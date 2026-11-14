import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { X } from "lucide-react";

export type TourRole = "pekerja" | "perusahaan";

interface TourStep {
  /** Nilai atribut data-tour pada elemen yang disorot. Kosong = kartu di tengah layar. */
  target?: string;
  title: string;
  body: string;
  /** Teks aksi yang diminta ke pengguna, mis. "Tekan tombol ini". */
  action?: string;
}

const WORKER_STEPS: TourStep[] = [
  {
    title: "Selamat datang di Rekhastha",
    body: "Tur singkat ini menunjukkan tombol-tombol penting untuk pekerja. Anda bisa menutupnya kapan saja dan membukanya lagi lewat tombol Panduan.",
  },
  {
    target: "radar-toggle",
    title: "Nyalakan radar",
    body: "Saat radar menyala, Anda menerima Broadcast Instan: lowongan mendesak dengan alarm dan bunyi. Izinkan lokasi dan notifikasi saat browser meminta.",
    action: "Setelah tur, geser saklar ini untuk menyalakan radar.",
  },
  {
    target: "worker-tabs",
    title: "Cari lowongan",
    body: "Daftar menampilkan kartu lowongan. Radar menampilkan peta. Jadwal berisi lowongan terjadwal. Lamar memantau status lamaran Anda.",
    action: "Setelah tur, pilih tab untuk berpindah tampilan.",
  },
  {
    target: "nav-chat",
    title: "Chat",
    body: "Chat dengan pemberi kerja terbuka setelah lamaran Anda Diterima. Pesan berisi nomor kontak atau ajakan bayar di luar aplikasi akan diblokir.",
  },
  {
    target: "guide-button",
    title: "Butuh bantuan?",
    body: "Tombol Panduan menyimpan langkah lengkap: melamar, presensi QR, sampai pencairan upah. Anda bisa membukanya kapan saja.",
  },
  {
    target: "nav-profile",
    title: "Profil dan verifikasi",
    body: "Lengkapi profil dan unggah KTP serta selfie di sini. Anda tidak bisa melamar sebelum profil lengkap. Di Profil > E-Wallet Anda juga bisa meminta pencairan upah.",
    action: "Setelah tur, tekan tombol ini untuk membuka profil Anda.",
  },
];

const COMPANY_STEPS: TourStep[] = [
  {
    title: "Selamat datang di Rekhastha",
    body: "Tur singkat ini menunjukkan cara memasang lowongan dan mengelola pelamar. Anda bisa menutupnya kapan saja dan membukanya lagi lewat tombol Panduan.",
  },
  {
    target: "company-tabs",
    title: "Tiga tampilan Beranda",
    body: "Lowongan untuk memasang dan mengelola lowongan. Analitik untuk pengeluaran dan rating. Radar untuk melihat jumlah pekerja siap kerja di sekitar usaha Anda.",
  },
  {
    target: "post-mode",
    title: "Pilih jenis lowongan",
    body: "Broadcast Instan untuk kebutuhan hari ini, disiarkan ke pekerja yang radarnya aktif. Posting Reguler untuk kontrak terjadwal sampai 6 bulan.",
    action: "Setelah tur, tekan salah satu untuk membuka formulirnya.",
  },
  {
    target: "post-submit",
    title: "Buat lowongan dan bayar",
    body: "Isi posisi, upah, dan alamat. Periksa Rincian Biaya Posting, lalu tekan tombol ini. Lowongan tayang setelah pembayaran terkonfirmasi.",
    action: "Tombol ini aktif setelah posisi dan upah terisi.",
  },
  {
    target: "bell",
    title: "Lamaran masuk",
    body: "Pelamar muncul di sini. Baca profil dan berkasnya, lalu tekan Terima, Tinjau, atau tolak. Setelah diterima, Anda bisa chat dengan pekerja.",
    action: "Setelah tur, tekan lonceng untuk membuka Lamaran Masuk.",
  },
  {
    target: "pay-button",
    title: "Pembayaran",
    body: "Lihat semua tagihan dan statusnya di sini, termasuk lowongan yang belum dibayar.",
  },
  {
    target: "nav-bisnis",
    title: "Rekhastha Bisnis",
    body: "Berlangganan untuk membuka QR Presensi GPS, kalkulator pajak, dan Kelola Tim.",
  },
  {
    target: "guide-button",
    title: "Butuh bantuan?",
    body: "Tombol Panduan menyimpan langkah lengkap: memilih pelamar, QR presensi, sengketa, dan penilaian pekerja.",
  },
  {
    target: "nav-profile",
    title: "Profil usaha",
    body: "Ubah nama usaha, alamat, WhatsApp, dan foto profil lewat Edit Profil.",
  },
];

const STORAGE_PREFIX = "rekhastha_tour_seen_v1:";

export function hasSeenTour(userId: string): boolean {
  try { return localStorage.getItem(STORAGE_PREFIX + userId) === "1"; } catch { return true; }
}

function markTourSeen(userId: string) {
  try { localStorage.setItem(STORAGE_PREFIX + userId, "1"); } catch { /* storage tidak tersedia */ }
}

/** Elemen pertama dengan data-tour tertentu yang benar-benar terlihat (nav mobile dan desktop berbagi id). */
function findTarget(id: string | undefined): HTMLElement | null {
  if (!id) return null;
  const nodes = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${id}"]`));
  return nodes.find((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }) ?? null;
}

interface Box { top: number; left: number; width: number; height: number }

interface AppTourProps {
  open: boolean;
  role: TourRole;
  userId: string;
  onClose: () => void;
}

const PAD = 6;
const CARD_W = 320;

export default function AppTour({ open, role, userId, onClose }: AppTourProps) {
  const steps = role === "perusahaan" ? COMPANY_STEPS : WORKER_STEPS;
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });

  const step = steps[index];

  const measure = useCallback(() => {
    setVp({ w: window.innerWidth, h: window.innerHeight });
    const el = findTarget(step?.target);
    if (!el) { setBox(null); return; }
    const r = el.getBoundingClientRect();
    setBox({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [step]);

  useEffect(() => { if (open) setIndex(0); }, [open, role]);

  // Gulirkan target ke area terlihat, lalu ukur ulang.
  useLayoutEffect(() => {
    if (!open) return;
    const el = findTarget(step?.target);
    el?.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
    measure();
    const t = setTimeout(measure, 250);
    return () => clearTimeout(t);
  }, [open, step, measure]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") back();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, measure, index]);

  function finish() {
    markTourSeen(userId);
    onClose();
  }
  function next() {
    if (index >= steps.length - 1) finish();
    else setIndex((i) => i + 1);
  }
  function back() { setIndex((i) => Math.max(0, i - 1)); }

  if (!open || !step) return null;

  const isLast = index === steps.length - 1;

  // Posisi kartu: di bawah target bila muat, selain itu di atasnya; tanpa target = tengah.
  const cardW = Math.min(CARD_W, vp.w - 24);
  let cardStyle: React.CSSProperties;
  if (box) {
    const below = box.top + box.height + PAD + 12;
    const placeBelow = below + 190 < vp.h || box.top < 200;
    const top = placeBelow ? Math.min(below, vp.h - 200) : Math.max(12, box.top - PAD - 12 - 190);
    const left = Math.min(Math.max(12, box.left + box.width / 2 - cardW / 2), vp.w - cardW - 12);
    cardStyle = { position: "fixed", top, left, width: cardW };
  } else {
    cardStyle = { position: "fixed", top: "50%", left: "50%", width: cardW, transform: "translate(-50%, -50%)" };
  }

  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-label="Tur interaktif Rekhastha" data-testid="app-tour">
      {/* Lapisan redup. Bila ada target, lubang disorot memakai box-shadow besar. */}
      {box ? (
        <div
          aria-hidden
          className="pointer-events-none fixed rounded-xl ring-2 ring-amber-400 transition-all duration-200"
          style={{
            top: box.top - PAD, left: box.left - PAD,
            width: box.width + PAD * 2, height: box.height + PAD * 2,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.6)",
          }}
        />
      ) : (
        <div aria-hidden className="fixed inset-0 bg-black/60" />
      )}
      {/* Penangkap klik: halaman di bawah tidak tersentuh selama tur berjalan. */}
      <div className="fixed inset-0" onClick={(e) => e.stopPropagation()} />

      <div style={cardStyle} className="rounded-2xl bg-white p-4 shadow-2xl">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[12px] font-black uppercase tracking-wide text-emerald-700">
            Langkah {index + 1} dari {steps.length}
          </p>
          <button type="button" onClick={finish} aria-label="Tutup tur" className="-mr-1 -mt-1 rounded-full p-1 text-gray-500 hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <h3 className="mt-1 text-base font-black text-gray-900">{step.title}</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-gray-600">{step.body}</p>
        {step.action && box && (
          <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-bold text-amber-800">{step.action}</p>
        )}
        {step.target && !box && (
          <p className="mt-2 text-[12px] text-gray-500">Tombol ini baru terlihat pada layar tertentu. Buka Panduan untuk langkah lengkapnya.</p>
        )}

        <div className="mt-3 flex items-center justify-between gap-2">
          <button type="button" onClick={finish} className="text-xs font-bold text-gray-500 hover:text-gray-600">
            Lewati
          </button>
          <div className="flex gap-2">
            {index > 0 && (
              <button type="button" onClick={back} className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-600 active:scale-95">
                Kembali
              </button>
            )}
            <button type="button" onClick={next} className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-black text-white active:scale-95">
              {isLast ? "Selesai" : "Lanjut"}
            </button>
          </div>
        </div>
        <div className="mt-3 flex justify-center gap-1" aria-hidden>
          {steps.map((_, i) => (
            <span key={i} className={`h-1.5 rounded-full transition-all ${i === index ? "w-4 bg-emerald-600" : "w-1.5 bg-gray-200"}`} />
          ))}
        </div>
      </div>
    </div>
  );
}
