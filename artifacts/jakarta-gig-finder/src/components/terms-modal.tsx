import { X, ShieldCheck, Briefcase, UserCheck, Scale } from "lucide-react";

interface TermsModalProps {
  onClose: () => void;
}

interface Clause {
  title: string;
  body: string;
}

const EMPLOYER_CLAUSES: Clause[] = [
  {
    title: "Data pemberi kerja",
    body: "Isi informasi pemberi kerja dan lowongan secara akurat. Data yang diminta bergantung pada kategori akun. Tinjau permintaan data dengan cermat dan baca Kebijakan Privasi di halaman /privasi.",
  },
  {
    title: "Pembayaran dan aktivasi lowongan",
    body: "Rincian biaya dan cara pembayaran ditampilkan saat membuat lowongan. Pembayaran transfer dikonfirmasi secara manual; lowongan baru aktif setelah status pembayaran dikonfirmasi di aplikasi. Pengecualian biaya berlaku sesuai status uji coba atau langganan yang ditampilkan. Status pembayaran di aplikasi bukan jaminan asuransi atau jaminan dana dari pihak ketiga.",
  },
  {
    title: "Perubahan dan pembatalan",
    body: "Jika lowongan atau jadwal perlu diubah, sampaikan melalui fitur yang tersedia dan informasikan kepada pihak terkait. Aplikasi tidak menjanjikan penalti pembatalan otomatis.",
  },
];

const WORKER_CLAUSES: Clause[] = [
  {
    title: "Identitas",
    body: "Jika diminta untuk verifikasi, kirimkan informasi yang benar melalui alur aplikasi. Pemeriksaan identitas dilakukan oleh tim; aplikasi tidak melakukan pencocokan biometrik otomatis.",
  },
  {
    title: "Presensi dan lokasi",
    body: "Fitur presensi dapat meminta akses lokasi perangkat dan mencatat kehadiran sesuai instruksi pada aplikasi. Presensi di Rekhastha tidak dengan sendirinya memberikan BPJS Ketenagakerjaan, asuransi, atau jaminan sosial.",
  },
  {
    title: "Pembayaran upah",
    body: "Periksa rincian upah dan status pembayaran pada lowongan serta aplikasi. Pembayaran diproses sesuai alur yang ditampilkan; status di aplikasi tidak menjanjikan perlindungan asuransi atau pembayaran otomatis.",
  },
  {
    title: "Keluhan dan sengketa",
    body: "Gunakan fitur keluhan atau sengketa yang tersedia untuk meminta peninjauan. Pengajuan ditinjau oleh tim Rekhastha; aplikasi tidak menjanjikan arbitrase yang mengikat.",
  },
];

function Section({
  icon,
  label,
  clauses,
}: {
  icon: React.ReactNode;
  label: string;
  clauses: Clause[];
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
          {icon}
        </div>
        <h3 className="text-sm font-bold text-gray-800 leading-tight">{label}</h3>
      </div>
      <ol className="space-y-3">
        {clauses.map((c, i) => (
          <li key={c.title} className="pl-3 border-l-2 border-emerald-100">
            <p className="text-xs font-semibold text-gray-800 mb-1">
              {i + 1}. {c.title}
            </p>
            <p className="text-[11px] text-gray-600 leading-relaxed text-justify">{c.body}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function TermsModal({ onClose }: TermsModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[90vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-gradient-to-br from-emerald-600 to-emerald-700 px-5 py-4 flex items-start justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-white font-bold text-base leading-tight">Syarat & Ketentuan</h2>
              <p className="text-emerald-100 text-[11px]">Draf operasional · belum final</p>
            </div>
          </div>
          <button
            data-testid="button-close-terms"
            onClick={onClose}
            className="text-white/80 hover:text-white p-1 -mr-1"
            aria-label="Tutup"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
          <p className="text-[11px] text-gray-500 leading-relaxed text-justify">
            Ini adalah ringkasan operasional, bukan perjanjian final atau nasihat hukum. Syarat dan
            Ketentuan final harus ditinjau dan disahkan sebelum pendaftaran publik dibuka. Kebijakan
            Privasi tersedia di halaman /privasi.
          </p>

          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-emerald-600 mb-3">
              Bagian I · Ketentuan Penyedia Pekerjaan (Employer)
            </div>
            <Section
              icon={<Briefcase className="w-4 h-4" />}
              label="Kewajiban Pemberi Kerja"
              clauses={EMPLOYER_CLAUSES}
            />
          </div>

          <div className="border-t border-gray-100 pt-5">
            <div className="text-[10px] font-bold uppercase tracking-wide text-emerald-600 mb-3">
              Bagian II · Ketentuan Mitra Pekerja (Worker)
            </div>
            <Section
              icon={<UserCheck className="w-4 h-4" />}
              label="Kewajiban Mitra Pekerja"
              clauses={WORKER_CLAUSES}
            />
          </div>

          {/* Draft status and unsupported coverage/escrow claims */}
          <div className="border-t-2 border-amber-200 pt-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                <Scale className="w-4 h-4" />
              </div>
              <h3 className="text-sm font-black text-amber-800 leading-tight uppercase">
                Catatan penting sebelum peluncuran
              </h3>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2.5">
              <p className="text-[11px] text-amber-950 leading-relaxed text-justify font-semibold">
                Fitur pembayaran, presensi, dan status dana mengikuti alur yang tersedia di aplikasi.
                Fitur tersebut tidak dengan sendirinya menjamin penitipan dana, pemulihan pembayaran,
                BPJS Ketenagakerjaan, asuransi, atau perlindungan sosial.
              </p>
              <p className="text-[11px] text-amber-950 leading-relaxed text-justify">
                Kebijakan Privasi (halaman /privasi) menjelaskan data yang dikumpulkan, penggunaannya,
                penyimpanan, dan penghapusannya. Sebelum pendaftaran publik dibuka, kebijakan tersebut
                dan proses pembayaran perlu ditinjau oleh pihak yang berwenang.
              </p>
            </div>
          </div>
        </div>

        {/* Footer action */}
        <div className="px-5 py-4 border-t border-gray-100 shrink-0">
          <button
            data-testid="button-agree-terms"
            onClick={onClose}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm py-3 rounded-xl transition-colors"
          >
            Saya Paham — tutup draf
          </button>
        </div>
      </div>
    </div>
  );
}
