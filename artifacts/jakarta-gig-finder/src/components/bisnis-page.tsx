import {
  Crown, CheckCircle2, Star, QrCode, Calculator, Users, Shield,
  Zap, Clock, RefreshCw, AlertCircle, ChevronRight, X, Sparkles,
} from "lucide-react";
import type { FC } from "react";
import { lazy, Suspense, useState, useEffect, useCallback } from "react";
const TaxCalculator = lazy(() => import("./tax-calculator"));
const TeamManager   = lazy(() => import("./team-manager"));
import { AuthUser } from "@/types/auth";
import {
  fetchSubscriptionPlans,
  fetchBisnisStatus,
  createSubscriptionOrder,
  type SubscriptionPlan,
  type BisnisStatus,
} from "@/lib/monetization-client";

interface BisnisPageProps {
  currentUser: AuthUser;
  onOpenPayments: () => void;
}

const fmt = (n: number) =>
  "Rp " + Math.round(n).toLocaleString("id-ID");

/**
 * Fitur per tier — dicocokkan dengan durasi paket dari database:
 *   Starter  = 1 bln  (~30 hari)
 *   Growth   = 3 bln  (~90 hari)
 *   Pro      = 6 bln  (~180 hari)
 *   Business = 12 bln (~365 hari)
 *
 * Setiap tier mewarisi semua fitur tier di bawahnya.
 */
interface PlanFeature {
  icon: React.ReactNode;
  title: string;
  desc: string;
  color: string;
  bg: string;
  minMonths: number; // tier minimum yang mendapat fitur ini
  badge?: string;    // label opsional di sudut fitur
}

const PLAN_FEATURES: PlanFeature[] = [
  // ── Starter (semua paket) ──────────────────────────────
  {
    icon: <QrCode className="w-5 h-5" />,
    title: "QR Presensi GPS",
    desc: "Generate QR absensi berbasis lokasi untuk karyawan harian. Pekerja hanya bisa clock-in dalam radius yang ditentukan.",
    color: "text-emerald-600",
    bg: "bg-emerald-50",
    minMonths: 1,
  },
  {
    icon: <Calculator className="w-5 h-5" />,
    title: "Kalkulator Gaji Harian",
    desc: "Hitung upah bersih dan kotor secara otomatis untuk setiap shift, termasuk lembur dan potongan.",
    color: "text-blue-600",
    bg: "bg-blue-50",
    minMonths: 1,
  },
  {
    icon: <Users className="w-5 h-5" />,
    title: "Kontak Pelamar Tanpa Batas",
    desc: "Lihat nomor WhatsApp & data lengkap semua pelamar — tanpa batasan 3 kontak gratis.",
    color: "text-violet-600",
    bg: "bg-violet-50",
    minMonths: 1,
  },
  {
    icon: <Shield className="w-5 h-5" />,
    title: "Badge Perusahaan Terverifikasi",
    desc: "Tanda centang hijau di profil perusahaan Anda. Meningkatkan kepercayaan pelamar secara signifikan.",
    color: "text-amber-600",
    bg: "bg-amber-50",
    minMonths: 1,
  },
  // ── Growth (3 bln ke atas) ──────────────────────────────
  {
    icon: <Zap className="w-5 h-5" />,
    title: "Posting Gig Prioritas",
    desc: "Lowongan Anda ditampilkan di urutan teratas pencarian selama masa aktif langganan.",
    color: "text-orange-600",
    bg: "bg-orange-50",
    minMonths: 3,
    badge: "Growth+",
  },
  {
    icon: <Star className="w-5 h-5" />,
    title: "Statistik Lamaran Detail",
    desc: "Lihat berapa orang yang melihat, menyimpan, dan melamar gig Anda. Optimalkan deskripsi gig berdasarkan data.",
    color: "text-yellow-600",
    bg: "bg-yellow-50",
    minMonths: 3,
    badge: "Growth+",
  },
  // ── Pro (6 bln ke atas) ────────────────────────────────
  {
    icon: <RefreshCw className="w-5 h-5" />,
    title: "Undang Pekerja Favorit",
    desc: "Simpan pekerja terbaik dan undang langsung ke gig baru tanpa menunggu lamaran masuk.",
    color: "text-teal-600",
    bg: "bg-teal-50",
    minMonths: 6,
    badge: "Pro+",
  },
  {
    icon: <Clock className="w-5 h-5" />,
    title: "Laporan Kehadiran PDF",
    desc: "Export laporan presensi dan penggajian bulanan dalam format PDF siap cetak.",
    color: "text-indigo-600",
    bg: "bg-indigo-50",
    minMonths: 6,
    badge: "Pro+",
  },
  // ── Business (12 bln) ─────────────────────────────────
  {
    icon: <ChevronRight className="w-5 h-5" />,
    title: "Multi-Cabang & Tim",
    desc: "Tambahkan akun tim Anda (HRD, pengawas) dengan akses terbatas per cabang. Kelola hingga 5 lokasi sekaligus.",
    color: "text-rose-600",
    bg: "bg-rose-50",
    minMonths: 12,
    badge: "Business",
  },
  {
    icon: <Calculator className="w-5 h-5" />,
    title: "Kalkulasi Potongan Pajak",
    desc: "Hitung PPh 21 dan BPJS TK/Kesehatan otomatis sesuai regulasi terkini. Unduh slip gaji digital.",
    color: "text-pink-600",
    bg: "bg-pink-50",
    minMonths: 12,
    badge: "Business",
  },
];

/** Fitur dasar yang terlihat di modal konfirmasi semua paket */
const FEATURES = PLAN_FEATURES.filter(f => f.minMonths === 1);

type BuyStep = "idle" | "confirm" | "paying" | "success" | "error";

export default function BisnisPage({ currentUser, onOpenPayments }: BisnisPageProps) {
  const [showTax, setShowTax] = useState(false);
  const [showTeam, setShowTeam] = useState(false);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [status, setStatus] = useState<BisnisStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan | null>(null);
  const [buyStep, setBuyStep] = useState<BuyStep>("idle");
  const [buyError, setBuyError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [p, s] = await Promise.all([
        fetchSubscriptionPlans(),
        fetchBisnisStatus(),
      ]);
      setPlans(p);
      setStatus(s);
    } catch (e) {
      setLoadError((e as Error).message ?? "Gagal memuat data langganan.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleBuy() {
    if (!selectedPlan) return;
    setBuyStep("paying");
    setBuyError("");
    try {
      const { order } = await createSubscriptionOrder(selectedPlan.id);
      setBuyStep("success");
      onOpenPayments();
    } catch (e) {
      setBuyError((e as Error).message ?? "Pembayaran gagal. Coba lagi.");
      setBuyStep("error");
    }
  }

  function handleSelectPlan(plan: SubscriptionPlan) {
    setSelectedPlan(plan);
    setBuyStep("confirm");
    setBuyError("");
  }

  function closeModal() {
    setSelectedPlan(null);
    setBuyStep("idle");
    setBuyError("");
  }

  const expiredAt = status?.expiredAt ? new Date(status.expiredAt) : null;
  const isPremium = status?.isPremium ?? false;

  const bestValuePlan = plans.reduce<SubscriptionPlan | null>((best, p) => {
    if (!best) return p;
    const perDay = p.promoPrice / p.durationDays;
    const bestPerDay = best.promoPrice / best.durationDays;
    return perDay < bestPerDay ? p : best;
  }, null);

  return (
    <>
    <div className="flex-1 overflow-y-auto" style={{ background: "#F8FAFC" }}>

      {/* ── Header ── */}
      <div
        className="px-5 pt-7 pb-6 flex flex-col gap-2"
        style={{ background: "linear-gradient(145deg, #0f3460 0%, #16213e 60%, #1a1a2e 100%)" }}
      >
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-amber-400/20 border border-amber-400/40 flex items-center justify-center">
            <Crown className="w-6 h-6 text-amber-300" />
          </div>
          <div>
            <h1 className="text-white font-black text-xl tracking-tight">Rekhastha Bisnis</h1>
            <p className="text-white/60 text-xs">by Tilu Saudara Solusindo · Alat manajemen pekerja harian</p>
          </div>
        </div>

        {/* Premium status badge */}
        {!loading && status && (
          <div className={`mt-3 rounded-2xl px-4 py-3 border flex items-center gap-3 ${
            isPremium
              ? "bg-amber-400/10 border-amber-400/30"
              : "bg-white/5 border-white/10"
          }`}>
            {isPremium ? (
              <>
                <Sparkles className="w-5 h-5 text-amber-300 shrink-0" />
                <div>
                  <p className="text-amber-200 font-bold text-sm">Premium Aktif</p>
                  {expiredAt && (
                    <p className="text-amber-300/70 text-[11px] mt-0.5">
                      Berlaku hingga {expiredAt.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}
                    </p>
                  )}
                </div>
              </>
            ) : (
              <>
                <Clock className="w-5 h-5 text-white/40 shrink-0" />
                <div>
                  <p className="text-white/70 font-semibold text-sm">Belum Berlangganan</p>
                  <p className="text-white/40 text-[11px] mt-0.5">Pilih paket di bawah untuk mulai</p>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Loading / Error ── */}
      {loading && (
        <div className="flex flex-col items-center justify-center gap-3 py-20">
          <span className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-400">Memuat paket…</p>
        </div>
      )}

      {!loading && loadError && (
        <div className="m-5 rounded-2xl border border-red-100 bg-red-50 px-4 py-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-700">Gagal memuat data</p>
            <p className="text-xs text-red-500 mt-0.5">{loadError}</p>
            <button
              onClick={load}
              className="mt-2 flex items-center gap-1.5 text-xs font-bold text-red-600"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Coba Lagi
            </button>
          </div>
        </div>
      )}

      {!loading && !loadError && (
        <>
          {/* ── Plans ── */}
          <div className="px-4 pt-5 pb-2">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Pilih Paket</p>
            <div className="grid grid-cols-2 gap-3">
              {plans.map((plan) => {
                const isBest = bestValuePlan?.id === plan.id;
                const perDay = Math.round(plan.promoPrice / plan.durationDays);
                const discount = Math.round(((plan.originalPrice - plan.promoPrice) / plan.originalPrice) * 100);
                return (
                  <button
                    key={plan.id}
                    onClick={() => handleSelectPlan(plan)}
                    className={`relative text-left rounded-2xl border-2 p-4 transition-all active:scale-95 ${
                      isBest
                        ? "border-amber-400 bg-gradient-to-br from-amber-50 to-orange-50"
                        : "border-gray-100 bg-white hover:border-emerald-200"
                    }`}
                  >
                    {isBest && (
                      <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-amber-400 text-white text-[10px] font-black px-2.5 py-0.5 rounded-full whitespace-nowrap">
                        ✦ TERBAIK
                      </div>
                    )}
                    {discount > 0 && (
                      <div className="absolute top-3 right-3 bg-red-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full">
                        -{discount}%
                      </div>
                    )}
                    <p className="font-black text-gray-900 text-base leading-tight">{plan.label}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5 font-medium">{plan.durationDays} hari</p>
                    <div className="mt-3">
                      <p className="text-[10px] text-gray-400 line-through leading-none">
                        {fmt(plan.originalPrice)}
                      </p>
                      <p className={`font-black text-lg leading-tight ${isBest ? "text-amber-600" : "text-gray-900"}`}>
                        {fmt(plan.promoPrice)}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        ~{fmt(perDay)}/hari
                      </p>
                    </div>
                    <div className={`mt-3 flex items-center gap-1 text-xs font-bold ${isBest ? "text-amber-600" : "text-emerald-600"}`}>
                      Pilih <ChevronRight className="w-3.5 h-3.5" />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Features per tier ── */}
          <div className="px-4 pt-4 pb-8">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Fitur per Paket</p>

            {/* Tier groups */}
            {[
              { label: "Semua Paket", minMonths: 1, color: "text-emerald-700", border: "border-emerald-200", bg: "bg-emerald-50" },
              { label: "Growth ke atas (3 bln+)", minMonths: 3, color: "text-orange-700", border: "border-orange-200", bg: "bg-orange-50" },
              { label: "Pro ke atas (6 bln+)", minMonths: 6, color: "text-indigo-700", border: "border-indigo-200", bg: "bg-indigo-50" },
              { label: "Business (12 bln)", minMonths: 12, color: "text-rose-700", border: "border-rose-200", bg: "bg-rose-50" },
            ].map((tier) => {
              const tierFeatures = PLAN_FEATURES.filter(f => f.minMonths === tier.minMonths);
              return (
                <div key={tier.minMonths} className="mb-4">
                  <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold mb-2 border ${tier.border} ${tier.bg} ${tier.color}`}>
                    {tier.minMonths === 1 ? "✦" : tier.minMonths === 12 ? "👑" : "+"} {tier.label}
                  </div>
                  <div className="space-y-2">
                    {tierFeatures.map((f, i) => (
                      <div key={i} className="bg-white rounded-xl border border-gray-100 p-3.5 flex items-start gap-3">
                        <div className={`w-9 h-9 rounded-xl ${f.bg} ${f.color} flex items-center justify-center shrink-0`}>
                          {f.icon}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-bold text-gray-900">{f.title}</p>
                            {isPremium && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{f.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}

            {/* Quick actions untuk subscriber */}
            {isPremium && (
              <div className="mb-4 grid grid-cols-2 gap-2">
                <button onClick={() => setShowTax(true)}
                  className="bg-white border border-emerald-200 rounded-2xl p-3.5 flex items-center gap-2.5 hover:bg-emerald-50 transition-colors text-left">
                  <div className="w-9 h-9 bg-emerald-100 rounded-xl flex items-center justify-center shrink-0">
                    <Calculator className="w-4 h-4 text-emerald-700" />
                  </div>
                  <div>
                    <p className="text-xs font-black text-gray-900">Hitung Pajak</p>
                    <p className="text-[10px] text-gray-500">PPh 21 + BPJS</p>
                  </div>
                </button>
                <button onClick={() => setShowTeam(true)}
                  className="bg-white border border-violet-200 rounded-2xl p-3.5 flex items-center gap-2.5 hover:bg-violet-50 transition-colors text-left">
                  <div className="w-9 h-9 bg-violet-100 rounded-xl flex items-center justify-center shrink-0">
                    <Users className="w-4 h-4 text-violet-700" />
                  </div>
                  <div>
                    <p className="text-xs font-black text-gray-900">Kelola Tim</p>
                    <p className="text-[10px] text-gray-500">Undang anggota</p>
                  </div>
                </button>
              </div>
            )}

          {/* Free tier note */}
            <div className="mt-2 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 flex items-start gap-2.5">
              <Zap className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <p className="text-xs text-emerald-700 leading-relaxed">
                <span className="font-bold">Posting lowongan selalu gratis</span> — Rekhastha Bisnis membuka fitur manajemen karyawan dan tim di atas.
              </p>
            </div>
          </div>
        </>
      )}

      {/* ── Confirm / Pay Modal ── */}
      {(buyStep === "confirm" || buyStep === "paying" || buyStep === "success" || buyStep === "error") && selectedPlan && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={buyStep === "paying" ? undefined : closeModal} />
          <div className="relative z-10 bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-sm mx-4 p-6 shadow-2xl">

            {buyStep === "success" ? (
              /* ── Success ── */
              <div className="flex flex-col items-center gap-4 py-4">
                <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
                  <CheckCircle2 className="w-9 h-9 text-emerald-500" />
                </div>
                <div className="text-center">
                  <p className="font-black text-gray-900 text-xl">Tagihan dibuat</p>
                  <p className="text-sm text-gray-500 mt-1.5 leading-relaxed">
                    Transfer untuk paket <span className="font-semibold text-gray-700">{selectedPlan.label}</span> melalui Pembayaran Manual.
                    Paket baru aktif setelah admin mengonfirmasi pembayaran.
                  </p>
                </div>
                <button
                  onClick={closeModal}
                  className="w-full bg-emerald-600 text-white font-bold py-3.5 rounded-2xl text-sm"
                >
                  Selesai
                </button>
              </div>
            ) : (
              /* ── Confirm / Paying / Error ── */
              <>
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-2">
                    <Crown className="w-5 h-5 text-amber-500" />
                    <h2 className="font-black text-gray-900 text-base">Konfirmasi Berlangganan</h2>
                  </div>
                  {buyStep !== "paying" && (
                    <button onClick={closeModal} className="text-gray-400 hover:text-gray-600">
                      <X className="w-5 h-5" />
                    </button>
                  )}
                </div>

                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-bold text-gray-900 text-sm">Rekhastha Bisnis {selectedPlan.label}</p>
                      <p className="text-xs text-gray-500 mt-0.5">untuk {currentUser.name}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-black text-amber-600 text-lg">{fmt(selectedPlan.promoPrice)}</p>
                      <p className="text-[10px] text-gray-400">{selectedPlan.durationDays} hari</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-2.5 mb-5">
                  {FEATURES.map((f, i) => (
                    <div key={i} className="flex items-center gap-2.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                      <span className="text-xs text-gray-600">{f.title}</span>
                    </div>
                  ))}
                </div>

                {buyStep === "error" && buyError && (
                  <div className="mb-4 rounded-xl bg-red-50 border border-red-100 px-3 py-2.5 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-red-600">{buyError}</p>
                  </div>
                )}

                <div className="flex gap-3">
                  {buyStep !== "paying" && (
                    <button
                      onClick={closeModal}
                      className="flex-1 bg-gray-100 text-gray-700 font-bold py-3.5 rounded-2xl text-sm"
                    >
                      Batal
                    </button>
                  )}
                  <button
                    onClick={buyStep === "error" ? handleBuy : buyStep === "confirm" ? handleBuy : undefined}
                    disabled={buyStep === "paying"}
                    className={`flex-1 font-bold py-3.5 rounded-2xl text-sm flex items-center justify-center gap-2 transition-all ${
                      buyStep === "paying"
                        ? "bg-emerald-400 text-white cursor-not-allowed"
                        : "bg-emerald-600 text-white active:scale-95"
                    }`}
                  >
                    {buyStep === "paying" ? (
                      <>
                        <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Memproses…
                      </>
                    ) : buyStep === "error" ? (
                      <>
                        <RefreshCw className="w-4 h-4" /> Coba Lagi
                      </>
                    ) : (
                      <>
                        <Star className="w-4 h-4" /> Bayar {fmt(selectedPlan.promoPrice)}
                      </>
                    )}
                  </button>
                </div>

              </>
            )}
          </div>
        </div>
      )}
    </div>

    {/* Modals */}
    {showTax && (
      <Suspense fallback={null}>
        <TaxCalculator onClose={() => setShowTax(false)} />
      </Suspense>
    )}
    {showTeam && (
      <Suspense fallback={null}>
        <TeamManager onClose={() => setShowTeam(false)} />
      </Suspense>
    )}
    </>
  );
}