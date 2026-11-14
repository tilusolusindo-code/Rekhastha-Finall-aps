import { useMemo } from "react";
import { CustomJob, durasiKontrakOptions } from "@/types/custom-job";
import { calcEscrowAmount, FLAT_ADMIN_FEES } from "@/types/escrow";
import { RatingPayload } from "@/components/rating-modal";
import { downloadCsv } from "@/lib/csv-export";

interface AnalyticsDashboardProps {
  customJobs: CustomJob[];
  ratings: RatingPayload[];
  totalApplicants: number;
}

function fmt(n: number) { return "Rp " + Math.round(n).toLocaleString("id-ID"); }

type FeeSnapshot = "saved" | "missing";

function workerTotal(job: CustomJob): number {
  return job.totalWorkerPayout ??
    calcEscrowAmount(job.nominal, job.pembayaran, job.jumlahHari ?? 1, job.kuota);
}

export default function AnalyticsDashboard({ customJobs, ratings, totalApplicants }: AnalyticsDashboardProps) {
  // ── Computed metrics ────────────────────────────────────────────
  const metrics = useMemo(() => {
    let totalGross = 0;
    let totalCommKnown = 0;   // exact + inferred only
    let unknownCount = 0;

    customJobs.forEach((job) => {
      const g = workerTotal(job);
      const fee = job.adminFeeAmount;
      totalGross += g;
      if (fee == null) {
        unknownCount += 1;
      } else {
        totalCommKnown += fee;
      }
    });

    const workerRatings = ratings.filter((r) => r.raterType === "company");
    const avgRating = workerRatings.length
      ? workerRatings.reduce((s, r) => s + r.stars, 0) / workerRatings.length
      : 0;

    const agencies = customJobs.filter((j) => j.isAgency).length;
    const hasUnknown = unknownCount > 0;

    return { totalGross, totalCommKnown, avgRating, agencies, unknownCount, hasUnknown };
  }, [customJobs, ratings]);

  // ── Per-job breakdown ────────────────────────────────────────────
  const jobBreakdowns = useMemo(() =>
    customJobs.map((job) => {
      const gross = workerTotal(job);
      const comm = job.adminFeeAmount ?? 0;
      const workerPay = gross;
      const certainty: FeeSnapshot = job.adminFeeAmount == null ? "missing" : "saved";
      return { job, gross, comm, workerPay, certainty };
    }),
  [customJobs]);

  const handleExportCsv = () => {
    const rows: (string | number)[][] = [
      ["Posisi", "Kategori", "Kuota", "Durasi", "Biaya Admin Flat (Rp)", "Total Payout Pekerja (Rp)", "Upah Pekerja (Rp)", "Status Snapshot"],
      ...jobBreakdowns.map(({ job, gross, comm, workerPay, certainty }) => [
        job.posisi,
        job.jobCategory ?? "-",
        job.kuota,
        durasiKontrakOptions.find((o) => o.value === (job.durasiKontrak ?? "harian"))?.label ?? "Harian",
        certainty === "missing" ? "" : comm,
        gross,
        workerPay,
        certainty === "saved" ? "Tersimpan" : "Belum dimigrasi",
      ]),
      [],
      ["Total Pengeluaran (Rp)", metrics.totalGross],
      ["Total Biaya Admin Tersimpan (Rp)", metrics.totalCommKnown],
      ["Rata-Rata Rating", metrics.avgRating ? metrics.avgRating.toFixed(1) : "-"],
      ["Total Pelamar", totalApplicants],
    ];
    downloadCsv(`laporan-keuangan-rekhastha-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  };

  const ratedByCompany = ratings.filter((r) => r.raterType === "company");

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50">
      <div className="p-4 space-y-4 pb-8">

        {/* Header */}
        <div className="pt-1 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-black text-gray-900 tracking-tight">Analitik Keuangan &amp; Performa</h2>
            <p className="text-xs text-gray-500 mt-0.5">Diperbarui otomatis setiap ada transaksi baru</p>
          </div>
          <button
            data-testid="button-export-report-csv"
            onClick={handleExportCsv}
            disabled={customJobs.length === 0}
            className="text-[12px] font-bold text-primary bg-primary/10 border border-primary/20 px-3 py-2.5 rounded-xl hover:bg-primary/15 transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Unduh Laporan
          </button>
        </div>

        {/* Warning banner for legacy gigs with unknown fee rates */}
        {metrics.hasUnknown && (
          <div className="rounded-xl px-4 py-3 bg-amber-50 border border-amber-200">
            <p className="text-[12px] text-amber-800 leading-relaxed">
              <span className="font-bold">{metrics.unknownCount} lowongan lama</span> belum menyimpan snapshot biaya admin.
              Baris tersebut tidak diberi estimasi, sehingga <span className="font-bold">tidak dihitung</span> dalam total biaya admin tersimpan.
            </p>
          </div>
        )}

        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-3">
          <MetricCard
            label="Total Pengeluaran"
            value={fmt(metrics.totalGross)}
            sub={`${customJobs.length} lowongan aktif`}
          />
          <MetricCard
            label="Biaya Admin Tersimpan"
            value={fmt(metrics.totalCommKnown)}
            sub={
              metrics.hasUnknown
                ? `${customJobs.length - metrics.unknownCount} dari ${customJobs.length} lowongan memiliki snapshot`
                : customJobs.length
                  ? `${customJobs.length} biaya tersimpan`
                  : "—"
            }
            dimmed={metrics.hasUnknown}
          />
          <MetricCard
            label="Rata-Rata Rating"
            value={metrics.avgRating ? metrics.avgRating.toFixed(1) + " ★" : "—"}
            sub={`${ratedByCompany.length} ulasan`}
            tone="amber"
          />
          <MetricCard
            label="Total Pelamar"
            value={String(totalApplicants)}
            sub={`${metrics.agencies} lowongan Agensi`}
          />
        </div>

        {/* Platform fee transparency */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 pt-4 pb-3 border-b border-gray-100">
            <p className="text-sm font-bold text-gray-900">Biaya Admin Flat</p>
            <p className="text-[12px] text-gray-500 mt-0.5">
              Sekali per lowongan, berdasarkan kategori; dibebaskan untuk langganan aktif atau masa uji coba
            </p>
          </div>

          <div className="px-4 py-4 space-y-4">
            <div className="rounded-xl px-4 py-4 space-y-3 bg-primary/5 border border-primary/15">
              <div>
                <p className="text-xs text-gray-600 mb-2">Tarif tetap per kategori</p>
                <div className="grid grid-cols-3 gap-2">
                  {(Object.entries(FLAT_ADMIN_FEES) as [string, number][]).map(([cat, amount]) => (
                    <div key={cat} className="rounded-lg px-2 py-2 text-center bg-white border border-gray-100">
                      <p className="text-[12px] text-gray-500 capitalize">{cat}</p>
                      <p className="text-sm font-black text-primary">{fmt(amount)}</p>
                    </div>
                  ))}
                </div>
              </div>
              <p className="text-[12px] text-gray-500 leading-relaxed">Ditagihkan sekali ke perusahaan · upah pekerja tidak dipotong</p>
            </div>

            <div className="space-y-2">
              {[
                "Escrow & perlindungan pembayaran",
                "Verifikasi identitas & anti-penipuan",
                "Mediasi sengketa & dukungan 24 jam",
              ].map((label) => (
                <div key={label} className="flex items-center gap-2.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                  <p className="text-[13px] text-gray-700">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Per-job table */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 pt-4 pb-3 border-b border-gray-100">
            <p className="text-sm font-bold text-gray-900">Rincian Per Lowongan</p>
          </div>

          {customJobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-1.5 text-center px-4">
              <p className="text-sm text-gray-700 font-semibold">Belum ada lowongan aktif</p>
              <p className="text-xs text-gray-500">Buat lowongan baru untuk melihat analitik</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {jobBreakdowns.map(({ job, gross, comm, workerPay, certainty }) => {
                const durasiLabel = durasiKontrakOptions.find((o) => o.value === (job.durasiKontrak ?? "harian"))?.label?.split(" ")[0] ?? "Harian";
                const isUnknown = certainty === "missing";
                return (
                  <div key={job.id} className={`px-4 py-3.5 ${isUnknown ? "opacity-80" : ""}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-sm font-bold text-gray-900 truncate">{job.posisi}</p>
                          {job.isAgency && (
                            <span className="text-[11px] font-black px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                              AGENCY JOB
                            </span>
                          )}
                          {isUnknown && (
                            <span
                              className="text-[11px] font-black px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200"
                              title="Snapshot biaya admin belum tersedia untuk lowongan lama"
                            >
                              DATA LAMA
                            </span>
                          )}
                        </div>
                        <p className="text-[12px] text-gray-500 mt-0.5">
                          {durasiLabel} · {job.kuota} org ·{" "}
                          {isUnknown
                            ? <span className="text-amber-700">biaya admin belum tersimpan</span>
                            : <>{fmt(comm)} biaya admin flat</>
                          }
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold text-gray-900">{fmt(gross)}</p>
                        {isUnknown ? (
                          <p className="text-[12px] text-amber-700">snapshot belum tersedia</p>
                        ) : (
                          <p className="text-[12px] text-primary">{fmt(comm)} biaya admin</p>
                        )}
                      </div>
                    </div>

                    {!isUnknown && (
                      <>
                        <div className="mt-2 h-1.5 rounded-full overflow-hidden bg-gray-100">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${gross > 0 ? ((workerPay / gross) * 100).toFixed(0) : 0}%` }}
                          />
                        </div>
                        <div className="flex justify-between mt-1">
                          <span className="text-[12px] text-gray-600">Payout pekerja: {fmt(workerPay)}</span>
                          <span className="text-[12px] text-primary">Biaya admin: {fmt(comm)}</span>
                        </div>
                      </>
                    )}

                    {isUnknown && <div className="mt-2 h-1.5 rounded-full bg-amber-100" />}
                  </div>
                );
              })}
            </div>
          )}

          {jobBreakdowns.some(b => b.certainty === "missing") && (
            <div className="px-4 py-2.5 border-t border-gray-100">
              <p className="text-[12px] text-gray-500 leading-relaxed">
                Biaya admin untuk lowongan lama yang belum dimigrasi tidak diperkirakan. Jalankan migrasi historis melalui panel admin untuk menyimpan snapshot.
              </p>
            </div>
          )}
        </div>

        {/* Ratings list */}
        {ratings.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 pt-4 pb-3 border-b border-gray-100">
              <p className="text-sm font-bold text-gray-900">Riwayat Rating Pekerja</p>
            </div>
            <div className="divide-y divide-gray-100">
              {ratedByCompany.slice(0, 5).map((r, i) => (
                <div key={i} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{r.targetName}</p>
                    {r.comment && <p className="text-[12px] text-gray-500 mt-0.5 truncate max-w-[180px]">{r.comment}</p>}
                  </div>
                  <span className="shrink-0 text-sm font-black text-amber-600">{r.stars}/5 ★</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Security notice */}
        <div className="rounded-xl px-4 py-3 bg-primary/5 border border-primary/15">
          <p className="text-[12px] text-gray-600 leading-relaxed">
            Semua transaksi dilindungi oleh sistem escrow dan anti-penipuan Rekhastha.
            Data diperbarui secara <span className="text-primary font-semibold">real-time</span> setiap transaksi baru.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Metric card ─────────────────────────────────────────────────────
function MetricCard({ label, value, sub, tone, dimmed }: {
  label: string; value: string; sub: string; tone?: "amber"; dimmed?: boolean;
}) {
  const color = dimmed ? "text-gray-500" : tone === "amber" ? "text-amber-600" : "text-primary";
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col gap-1.5">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <div className="flex items-baseline gap-1.5 flex-wrap">
        <p className={`text-lg font-black leading-tight ${color}`}>{value}</p>
        {dimmed && <span className="text-[11px] font-bold text-amber-700 uppercase tracking-wide">sebagian</span>}
      </div>
      <p className="text-[12px] text-gray-500">{sub}</p>
    </div>
  );
}
