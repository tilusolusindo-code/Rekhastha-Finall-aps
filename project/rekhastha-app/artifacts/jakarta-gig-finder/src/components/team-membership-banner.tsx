import { useEffect, useState } from "react";
import { Users, Shield, Calculator, Eye, Building2, ChevronRight } from "lucide-react";

interface Membership {
  role: "hr" | "supervisor" | "finance";
  accepted_at: string;
  company_id: string;
  company_name: string;
  nama_perusahaan?: string;
}

const ROLE_INFO = {
  hr:         { label: "HR / Rekrutmen",      icon: <Users className="w-4 h-4" />,      color: "text-violet-700", bg: "bg-violet-100",  desc: "Lihat lamaran & kelola pekerja" },
  supervisor: { label: "Supervisor Lapangan", icon: <Eye className="w-4 h-4" />,        color: "text-blue-700",   bg: "bg-blue-100",    desc: "Lihat presensi & gig yang ditugaskan" },
  finance:    { label: "Keuangan",            icon: <Calculator className="w-4 h-4" />, color: "text-amber-700",  bg: "bg-amber-100",   desc: "Lihat & export laporan keuangan" },
};

export function TeamMembershipBanner() {
  const [membership, setMembership] = useState<Membership | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/team/my-membership", { credentials: "same-origin" })
      .then(r => r.json())
      .then(d => setMembership(d.membership ?? null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading || !membership) return null;

  const r = ROLE_INFO[membership.role] ?? ROLE_INFO.hr;
  const companyDisplay = membership.nama_perusahaan || membership.company_name;
  const since = new Date(membership.accepted_at).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className={`mx-4 mt-4 rounded-2xl border ${r.bg} p-4 flex items-start gap-3`}>
      <div className={`w-10 h-10 rounded-xl ${r.bg} border border-white/60 flex items-center justify-center shrink-0 ${r.color}`}>
        <Building2 className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-black ${r.color} uppercase tracking-wide`}>Anggota Tim</p>
        <p className="text-sm font-bold text-gray-900 mt-0.5 truncate">{companyDisplay}</p>
        <div className="flex items-center gap-1.5 mt-1">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/70 ${r.color}`}>
            {r.icon} {r.label}
          </span>
        </div>
        <p className="text-[10px] text-gray-400 mt-1">Aktif sejak {since}</p>
      </div>
    </div>
  );
}

/** Tampilan penuh bisnis page untuk anggota tim (bukan owner) */
export function TeamMemberBisnisView({ membership }: { membership: Membership }) {
  const r = ROLE_INFO[membership.role] ?? ROLE_INFO.hr;
  const companyDisplay = membership.nama_perusahaan || membership.company_name;

  const ACCESS_MAP = {
    hr: [
      { icon: <Users className="w-4 h-4" />, title: "Lihat Semua Lamaran", desc: "Buka dan kelola lamaran masuk untuk semua lowongan perusahaan." },
      { icon: <Shield className="w-4 h-4" />, title: "Data Lengkap Pelamar", desc: "Lihat nomor HP, profil, dan dokumen pelamar tanpa batas." },
    ],
    supervisor: [
      { icon: <Eye className="w-4 h-4" />, title: "Pantau Presensi", desc: "Lihat rekap absensi QR GPS semua pekerja yang ditugaskan." },
      { icon: <Users className="w-4 h-4" />, title: "Gig yang Ditugaskan", desc: "Lihat daftar pekerjaan dan pekerja aktif di lapangan." },
    ],
    finance: [
      { icon: <Calculator className="w-4 h-4" />, title: "Laporan Keuangan", desc: "Akses slip gaji, riwayat pembayaran, dan rekap pajak pekerja." },
      { icon: <ChevronRight className="w-4 h-4" />, title: "Export Data", desc: "Unduh laporan dalam format CSV atau PDF untuk keperluan akuntansi." },
    ],
  };

  const accesses = ACCESS_MAP[membership.role] ?? ACCESS_MAP.hr;

  return (
    <div className="flex-1 overflow-y-auto" style={{ background: "#F8FAFC" }}>
      {/* Header */}
      <div className="px-5 pt-7 pb-6" style={{ background: "linear-gradient(145deg, #0f3460 0%, #16213e 60%, #1a1a2e 100%)" }}>
        <div className="flex items-center gap-3">
          <div className={`w-12 h-12 rounded-2xl ${r.bg} border border-white/20 flex items-center justify-center`}>
            <span className={r.color}>{r.icon}</span>
          </div>
          <div>
            <h1 className="text-white font-black text-xl tracking-tight">Tim {companyDisplay}</h1>
            <p className="text-white/60 text-xs">Anda bergabung sebagai {r.label}</p>
          </div>
        </div>

        <div className={`mt-4 rounded-2xl px-4 py-3 border ${r.bg} border-white/10 flex items-center gap-3`}>
          <div className={`w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center ${r.color}`}>
            {r.icon}
          </div>
          <div>
            <p className={`font-bold text-sm ${r.color}`}>{r.label}</p>
            <p className="text-white/50 text-[11px] mt-0.5">{r.desc}</p>
          </div>
        </div>
      </div>

      {/* Akses yang dimiliki */}
      <div className="px-4 pt-5 pb-8">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Akses Anda</p>
        <div className="space-y-2">
          {accesses.map((a, i) => (
            <div key={i} className={`bg-white rounded-2xl border border-gray-100 p-4 flex items-start gap-3`}>
              <div className={`w-9 h-9 rounded-xl ${r.bg} ${r.color} flex items-center justify-center shrink-0`}>
                {a.icon}
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900">{a.title}</p>
                <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{a.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
          <p className="text-xs text-gray-500 leading-relaxed">
            Akses Anda dikelola oleh admin <span className="font-semibold text-gray-700">{companyDisplay}</span>.
            Hubungi mereka untuk mengubah role atau akses.
          </p>
        </div>
      </div>
    </div>
  );
}
