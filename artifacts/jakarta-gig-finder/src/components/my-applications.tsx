import { useState } from "react";
import { ClipboardList, Building2, Clock, CheckCircle2, XCircle, Hourglass, MessageSquare, Zap, CalendarDays } from "lucide-react";
import { ApplicationNotification, ApplicationStatus } from "@/types/notification";
import { CustomJob, paymentUnits } from "@/types/custom-job";

interface MyApplicationsProps {
  notifications: ApplicationNotification[];
  customJobs: CustomJob[];
  workerName: string;
  workerId: string;
  loading?: boolean;
  loadError?: boolean;
  onChat: (job: CustomJob, notif: ApplicationNotification) => void;
}

const STATUS_CONFIG: Record<ApplicationStatus, { label: string; cls: string; icon: React.ReactNode }> = {
  baru: {
    label: "Menunggu",
    cls: "bg-amber-50 text-amber-800",
    icon: <Hourglass className="w-3.5 h-3.5" />,
  },
  ditinjau: {
    label: "Ditinjau",
    cls: "bg-amber-50 text-amber-800",
    icon: <Hourglass className="w-3.5 h-3.5" />,
  },
  diterima: {
    label: "Diterima",
    cls: "bg-emerald-50 text-emerald-800",
    icon: <CheckCircle2 className="w-3.5 h-3.5" />,
  },
  ditolak: {
    label: "Ditolak",
    cls: "bg-red-50 text-red-600",
    icon: <XCircle className="w-3.5 h-3.5" />,
  },
  selesai: {
    label: "Selesai",
    cls: "bg-gray-100 text-gray-600",
    icon: <CheckCircle2 className="w-3.5 h-3.5" />,
  },
};

const STEPS = ["Dikirim", "Ditinjau", "Diterima"];
const STEP_REACHED: Record<ApplicationStatus, number> = { baru: 1, ditinjau: 2, diterima: 3, selesai: 3, ditolak: 0 };

type Filter = "semua" | "menunggu" | "diterima" | "selesai";

export default function MyApplications({
  notifications,
  customJobs,
  workerName,
  workerId,
  loading = false,
  loadError = false,
  onChat,
}: MyApplicationsProps) {
  const [filter, setFilter] = useState<Filter>("semua");

  const myApplications = notifications.filter(
    (n) => n.workerId === workerId || n.applicantName === workerName,
  );

  const statusOf = (n: ApplicationNotification): ApplicationStatus => n.status ?? "baru";
  const counts = {
    semua: myApplications.length,
    menunggu: myApplications.filter((n) => statusOf(n) === "baru" || statusOf(n) === "ditinjau").length,
    diterima: myApplications.filter((n) => statusOf(n) === "diterima").length,
    selesai: myApplications.filter((n) => statusOf(n) === "selesai").length,
  };
  const visible = myApplications.filter((n) => {
    const st = statusOf(n);
    if (filter === "semua") return true;
    if (filter === "menunggu") return st === "baru" || st === "ditinjau";
    return st === filter;
  });
  const filters: { key: Filter; label: string }[] = [
    { key: "semua", label: "Semua" },
    { key: "menunggu", label: "Menunggu" },
    { key: "diterima", label: "Diterima" },
    { key: "selesai", label: "Selesai" },
  ];

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50">
      <div className="p-4 space-y-4">
        <div>
          <h2 className="text-[26px] font-extrabold leading-tight tracking-tight text-gray-900">Lamaran saya</h2>
          <p className="text-sm text-gray-500">
            {myApplications.length > 0
              ? `${myApplications.length} lamaran, ${counts.menunggu} menunggu jawaban`
              : "Riwayat semua lamaran Anda"}
          </p>
        </div>

        {myApplications.length > 0 && (
          <div className="grid grid-cols-4 gap-1" role="tablist" aria-label="Filter lamaran">
            {filters.map((f) => {
              const active = filter === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFilter(f.key)}
                  className={`flex h-9 items-center justify-center gap-0.5 whitespace-nowrap rounded-full border px-1 text-[12px] max-[360px]:text-[11px] max-[360px]:px-0 font-bold transition-colors ${
                    active ? "border-emerald-900 bg-emerald-900 text-white" : "border-gray-200 bg-white text-gray-700"
                  }`}
                >
                  <span>{f.label}</span>
                  <span className={`text-[10.5px] font-extrabold ${active ? "text-white/80" : "text-gray-400"}`}>{counts[f.key]}</span>
                </button>
              );
            })}
          </div>
        )}

        {loading && myApplications.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-16 gap-3">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
              <ClipboardList className="w-8 h-8 text-primary/50 animate-pulse" />
            </div>
            <p className="font-bold text-gray-700 text-sm">Memuat riwayat lamaran…</p>
          </div>
        ) : loadError && myApplications.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-16 gap-3">
            <div className="w-16 h-16 rounded-2xl bg-amber-50 flex items-center justify-center">
              <ClipboardList className="w-8 h-8 text-amber-500" />
            </div>
            <p className="font-bold text-gray-700 text-sm">Riwayat belum dapat dimuat</p>
            <p className="text-xs text-gray-400 leading-relaxed max-w-[260px]">
              Kami akan mencoba kembali otomatis. Periksa koneksi Anda jika daftar belum muncul.
            </p>
          </div>
        ) : myApplications.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-16 gap-3">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
              <ClipboardList className="w-8 h-8 text-primary/40" />
            </div>
            <p className="font-bold text-gray-700 text-sm">Belum ada lamaran</p>
            <p className="text-xs text-gray-400 leading-relaxed max-w-[240px]">
              Lamar lowongan dari feed Radar atau Terjadwal — semua riwayat lamaran Anda akan tampil di sini.
            </p>
          </div>
        ) : visible.length === 0 ? (
          <p className="py-10 text-center text-sm font-semibold text-gray-500">Tidak ada lamaran pada filter ini.</p>
        ) : (
          visible.map((notif) => {
            const job = customJobs.find((j) => j.id === notif.jobId);
            const st = statusOf(notif);
            const cfg = STATUS_CONFIG[st];
            const reached = STEP_REACHED[st];
            return (
              <div
                key={notif.id}
                className="flex flex-col gap-3 rounded-[22px] border border-gray-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[18px] font-extrabold leading-tight tracking-tight text-gray-900">{notif.jobTitle}</p>
                    {job && (
                      <p className="mt-0.5 flex items-center gap-1 text-[13px] text-gray-500">
                        <Building2 className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{job.namaPerusahaan || "Perusahaan"}</span>
                      </p>
                    )}
                  </div>
                  <div className={`flex h-[26px] shrink-0 items-center gap-1 rounded-full px-2.5 text-[11.5px] font-extrabold ${cfg.cls}`}>
                    {cfg.icon}
                    {cfg.label}
                  </div>
                </div>

                {job && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] font-semibold text-gray-600">
                    <span className="tabular-nums text-gray-900">
                      Rp {job.nominal.toLocaleString("id-ID")} <span className="font-medium text-gray-500">per {paymentUnits[job.pembayaran]}</span>
                    </span>
                    {job.hiringMode && (
                      <span className={`flex items-center gap-1 ${job.hiringMode === "cepat" ? "text-orange-700" : "text-blue-700"}`}>
                        {job.hiringMode === "cepat" ? <Zap className="h-3.5 w-3.5" /> : <CalendarDays className="h-3.5 w-3.5" />}
                        {job.hiringMode === "cepat" ? "Instan" : "Terjadwal"}
                      </span>
                    )}
                  </div>
                )}

                {st !== "ditolak" && (
                  <div aria-label={`Tahap lamaran: ${cfg.label}`}>
                    <div className="grid grid-cols-3 gap-1.5">
                      {STEPS.map((_, i) => (
                        <span key={i} className={`h-1.5 rounded-full ${i < reached ? "bg-primary" : "bg-gray-200"}`} />
                      ))}
                    </div>
                    <div className="mt-1.5 grid grid-cols-3 gap-1.5 text-[11.5px] font-bold">
                      {STEPS.map((label, i) => (
                        <span key={label} className={i < reached ? "text-emerald-900" : "text-gray-400"}>{label}</span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-1 text-[11px] text-gray-400">
                  <Clock className="h-3 w-3" />
                  Dilamar {notif.timestamp.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
                </div>

                {st === "diterima" && (
                  <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
                    Lamaran Anda diterima. Silakan clock-in di lokasi kerja.
                  </div>
                )}
                {st === "ditolak" && (
                  <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600">
                    Lamaran ini tidak dilanjutkan oleh perusahaan.
                  </div>
                )}

                {(st === "diterima" || st === "selesai") && job && (
                  <button
                    onClick={() => onChat(job, notif)}
                    className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-primary text-sm font-extrabold text-white transition-all hover:bg-primary/90 active:scale-[0.98]"
                  >
                    <MessageSquare className="h-4 w-4" />
                    Chat dengan perusahaan
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
