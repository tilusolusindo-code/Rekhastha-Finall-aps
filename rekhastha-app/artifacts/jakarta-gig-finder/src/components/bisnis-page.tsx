import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import { TeamMemberBisnisView } from "./team-membership-banner";
import MidtransSnapModal from "./midtrans-snap-modal";
import {
  Crown, CheckCircle2, Star, QrCode, Calculator, Users, Shield,
  Zap, Clock, RefreshCw, AlertCircle, ChevronRight, X, Sparkles,
  TrendingUp, FileText, Building2, ArrowRight, Lock,
} from "lucide-react";
import { AuthUser } from "@/types/auth";
import {
  fetchSubscriptionPlans,
  fetchBisnisStatus,
  createSubscriptionOrder,
  type SubscriptionPlan,
  type BisnisStatus,
} from "@/lib/monetization-client";

const TaxCalculator = lazy(() => import("./tax-calculator"));
const TeamManager   = lazy(() => import("./team-manager"));

interface BisnisPageProps {
  currentUser: AuthUser;
  onOpenPayments: () => void;
}

const fmt = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

// ── Fitur per tier ──────────────────────────────────────────────────────────
interface PlanFeature {
  icon: React.ReactNode;
  title: string;
  desc: string;
  accentColor: string;    // warna ikon
  minMonths: number;
}

const PLAN_FEATURES: PlanFeature[] = [
  // Starter — semua paket
  { icon: <QrCode className="w-4 h-4" />,    title: "QR Presensi GPS",          desc: "Absensi berbasis lokasi — pekerja hanya bisa clock-in dalam radius yang ditentukan.",            accentColor: "#10b981", minMonths: 1 },
  { icon: <Calculator className="w-4 h-4" />, title: "Kalkulator Gaji Harian",   desc: "Hitung upah bersih & kotor otomatis per shift, lembur, dan potongan.",                          accentColor: "#3b82f6", minMonths: 1 },
  { icon: <Users className="w-4 h-4" />,      title: "Kontak Pelamar Tanpa Batas", desc: "Lihat nomor WhatsApp & data lengkap semua pelamar tanpa batasan.",                             accentColor: "#8b5cf6", minMonths: 1 },
  { icon: <Shield className="w-4 h-4" />,     title: "Badge Terverifikasi",       desc: "Centang hijau di profil perusahaan Anda, meningkatkan kepercayaan pelamar.",                    accentColor: "#f59e0b", minMonths: 1 },
  // Growth — 3 bln+
  { icon: <Zap className="w-4 h-4" />,        title: "Posting Prioritas",         desc: "Lowongan Anda muncul di urutan teratas feed pencarian pekerja.",                                accentColor: "#f97316", minMonths: 3 },
  { icon: <TrendingUp className="w-4 h-4" />, title: "Statistik Lamaran Detail",  desc: "Lihat berapa orang melihat, menyimpan, dan melamar gig Anda.",                                 accentColor: "#eab308", minMonths: 3 },
  // Pro — 6 bln+
  { icon: <Star className="w-4 h-4" />,       title: "Undang Pekerja Favorit",    desc: "Simpan & undang pekerja terbaik langsung ke gig baru.",                                        accentColor: "#14b8a6", minMonths: 6 },
  { icon: <FileText className="w-4 h-4" />,   title: "Laporan Kehadiran PDF",     desc: "Export laporan presensi dan penggajian bulanan, siap cetak.",                                  accentColor: "#6366f1", minMonths: 6 },
  // Business — 12 bln
  { icon: <Building2 className="w-4 h-4" />,  title: "Multi-Cabang & Tim",        desc: "Tambahkan akun tim (HRD, pengawas) dengan akses terbatas per cabang.",                        accentColor: "#ec4899", minMonths: 12 },
  { icon: <Calculator className="w-4 h-4" />, title: "Kalkulasi Potongan Pajak",  desc: "Hitung PPh 21 otomatis sesuai regulasi terkini. Unduh slip gaji digital.",                    accentColor: "#f43f5e", minMonths: 12 },
];

const TIER_META = [
  { minMonths: 1,  label: "Semua Paket",         pill: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" },
  { minMonths: 3,  label: "Growth ke atas",       pill: "bg-orange-500/20 text-orange-300 border-orange-500/30" },
  { minMonths: 6,  label: "Pro ke atas",          pill: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30" },
  { minMonths: 12, label: "Business eksklusif",   pill: "bg-rose-500/20 text-rose-300 border-rose-500/30" },
];

type BuyStep = "idle" | "confirm" | "paying" | "success" | "error";

export default function BisnisPage({ currentUser, onOpenPayments }: BisnisPageProps) {
  const [showTax, setShowTax]   = useState(false);
  const [showTeam, setShowTeam] = useState(false);
  const [plans, setPlans]       = useState<SubscriptionPlan[]>([]);
  const [status, setStatus]     = useState<BisnisStatus | null>(null);
  const [loading, setLoading]   = useState(true);
  const [loadError, setLoadError] = useState("");
  const [membership, setMembership] = useState<any>(null);
  const [membershipLoaded, setMembershipLoaded] = useState(false);

  // Cek apakah user ini anggota tim seseorang
  useEffect(() => {
    fetch("/api/team/my-membership", { credentials: "same-origin" })
      .then(r => r.json())
      .then(d => setMembership(d.membership ?? null))
      .catch(() => {})
      .finally(() => setMembershipLoaded(true));
  }, []);

  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan | null>(null);
  const [buyStep, setBuyStep]   = useState<BuyStep>("idle");
  const [buyError, setBuyError] = useState("");
  const [showSnap, setShowSnap] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setLoadError("");
    try {
      const [p, s] = await Promise.all([fetchSubscriptionPlans(), fetchBisnisStatus()]);
      setPlans(p); setStatus(s);
    } catch (e) {
      setLoadError((e as Error).message ?? "Gagal memuat data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function handleBuy() {
    if (!selectedPlan) return;
    setShowSnap(true);
  }

  function handleSelectPlan(plan: SubscriptionPlan) {
    setSelectedPlan(plan); setBuyStep("confirm"); setBuyError("");
  }

  function closeModal() {
    setSelectedPlan(null); setBuyStep("idle"); setBuyError(""); setShowSnap(false);
  }

  function handleSnapSuccess() {
    setShowSnap(false);
    setBuyStep("success");
    // Reload status langganan setelah bayar
    void load();
  }

  const expiredAt    = status?.expiredAt ? new Date(status.expiredAt) : null;
  const isPremium    = status?.isPremium ?? false;
  const bestValuePlan = plans.reduce<SubscriptionPlan | null>((best, p) => {
    if (!best) return p;
    return (p.promoPrice / p.durationDays) < (best.promoPrice / best.durationDays) ? p : best;
  }, null);

  // ── Kalau user adalah anggota tim, tampilkan view khusus ──────────────────
  if (membershipLoaded && membership) {
    return <TeamMemberBisnisView membership={membership} />;
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <>
    {/* ── Midtrans Snap Modal ── */}
    {showSnap && selectedPlan && (
      <MidtransSnapModal
        type="subscription"
        planId={selectedPlan.id}
        planLabel={selectedPlan.label}
        amount={selectedPlan.promoPrice}
        onSuccess={handleSnapSuccess}
        onClose={() => { setShowSnap(false); setBuyStep("idle"); }}
      />
    )}

    {/* ── DARK BACKGROUND WRAPPER ── */}
    <div className="flex-1 overflow-y-auto" style={{ background: "#0d1117" }}>

      {/* ── HERO HEADER ── */}
      <div className="relative overflow-hidden px-5 pt-8 pb-7"
        style={{ background: "linear-gradient(160deg, #0f1923 0%, #0d1117 100%)" }}>
        {/* subtle radial glow */}
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse 60% 40% at 50% 0%, rgba(251,191,36,0.08) 0%, transparent 70%)" }} />

        <div className="relative flex items-center gap-4 mb-5">
          <div className="relative">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, #f59e0b, #d97706)", boxShadow: "0 0 24px rgba(245,158,11,0.35)" }}>
              <Crown className="w-7 h-7 text-white" />
            </div>
          </div>
          <div>
            <h1 className="text-white font-black text-2xl tracking-tight leading-none">Rekhastha Bisnis</h1>
            <p className="text-white/40 text-xs mt-1">Tilu Saudara Solusindo · Manajemen pekerja harian</p>
          </div>
        </div>

        {/* Status card */}
        {!loading && status && (
          isPremium ? (
            <div className="relative rounded-2xl px-5 py-4 overflow-hidden"
              style={{ background: "linear-gradient(135deg, rgba(245,158,11,0.15), rgba(217,119,6,0.08))", border: "1px solid rgba(245,158,11,0.25)" }}>
              <div className="absolute right-4 top-3 opacity-10">
                <Crown className="w-16 h-16 text-amber-400" />
              </div>
              <div className="flex items-center gap-2.5">
                <Sparkles className="w-5 h-5 text-amber-400 shrink-0" />
                <div>
                  <p className="text-amber-300 font-black text-base leading-none">Premium Aktif</p>
                  {expiredAt && (
                    <p className="text-amber-400/60 text-xs mt-1">
                      Aktif hingga {expiredAt.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}
                    </p>
                  )}
                </div>
              </div>
              {/* Quick action pills */}
              <div className="flex gap-2 mt-4">
                <button onClick={() => setShowTax(true)}
                  className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all active:scale-95"
                  style={{ background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.3)", color: "#6ee7b7" }}>
                  <Calculator className="w-3.5 h-3.5" /> Hitung Pajak
                </button>
                <button onClick={() => setShowTeam(true)}
                  className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all active:scale-95"
                  style={{ background: "rgba(139,92,246,0.15)", border: "1px solid rgba(139,92,246,0.3)", color: "#c4b5fd" }}>
                  <Users className="w-3.5 h-3.5" /> Kelola Tim
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl px-5 py-4"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="flex items-center gap-2.5">
                <Lock className="w-4 h-4 text-white/30 shrink-0" />
                <div>
                  <p className="text-white/60 font-semibold text-sm">Belum Berlangganan</p>
                  <p className="text-white/30 text-xs mt-0.5">Pilih paket di bawah untuk mulai</p>
                </div>
              </div>
            </div>
          )
        )}
      </div>

      {/* ── LOADING / ERROR ── */}
      {loading && (
        <div className="flex flex-col items-center justify-center gap-3 py-24">
          <span className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-white/30">Memuat paket…</p>
        </div>
      )}
      {!loading && loadError && (
        <div className="m-5 rounded-2xl px-4 py-4 flex items-start gap-3"
          style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-300">Gagal memuat</p>
            <p className="text-xs text-red-400/70 mt-0.5">{loadError}</p>
            <button onClick={load} className="mt-2 flex items-center gap-1.5 text-xs font-bold text-red-400">
              <RefreshCw className="w-3.5 h-3.5" /> Coba Lagi
            </button>
          </div>
        </div>
      )}

      {!loading && !loadError && (
        <>
          {/* ── PILIH PAKET ── */}
          <div className="px-4 pt-6 pb-2">
            <p className="text-[11px] font-bold uppercase tracking-widest mb-4"
              style={{ color: "rgba(255,255,255,0.3)" }}>Pilih Paket</p>

            <div className="grid grid-cols-2 gap-3">
              {plans.map((plan) => {
                const isBest   = bestValuePlan?.id === plan.id;
                const perDay   = Math.round(plan.promoPrice / plan.durationDays);
                const discount = Math.round(((plan.originalPrice - plan.promoPrice) / plan.originalPrice) * 100);
                return (
                  <button key={plan.id} onClick={() => handleSelectPlan(plan)}
                    className="relative text-left rounded-2xl p-4 transition-all active:scale-95"
                    style={isBest ? {
                      background: "linear-gradient(135deg, rgba(245,158,11,0.18), rgba(217,119,6,0.10))",
                      border: "1.5px solid rgba(245,158,11,0.45)",
                      boxShadow: "0 0 20px rgba(245,158,11,0.12)",
                    } : {
                      background: "rgba(255,255,255,0.04)",
                      border: "1.5px solid rgba(255,255,255,0.08)",
                    }}>

                    {isBest && (
                      <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] font-black px-2.5 py-0.5 rounded-full"
                        style={{ background: "linear-gradient(90deg,#f59e0b,#d97706)", color: "#fff" }}>
                        ✦ TERBAIK
                      </div>
                    )}
                    {discount > 0 && (
                      <div className="absolute top-3 right-3 text-[9px] font-black px-1.5 py-0.5 rounded-full"
                        style={{ background: "rgba(239,68,68,0.9)", color: "#fff" }}>
                        -{discount}%
                      </div>
                    )}

                    <p className={`font-black text-sm leading-tight ${isBest ? "text-amber-200" : "text-white"}`}>{plan.label}</p>
                    <p className="text-[10px] mt-0.5 font-medium" style={{ color: "rgba(255,255,255,0.3)" }}>{plan.durationDays} hari</p>

                    <div className="mt-3">
                      <p className="text-[10px] line-through leading-none" style={{ color: "rgba(255,255,255,0.25)" }}>
                        {fmt(plan.originalPrice)}
                      </p>
                      <p className={`font-black text-lg leading-tight ${isBest ? "text-amber-300" : "text-white"}`}>
                        {fmt(plan.promoPrice)}
                      </p>
                      <p className="text-[10px] mt-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>
                        ~{fmt(perDay)}/hari
                      </p>
                    </div>

                    <div className={`mt-3 flex items-center gap-1 text-xs font-bold ${isBest ? "text-amber-400" : "text-emerald-400"}`}>
                      Pilih <ChevronRight className="w-3.5 h-3.5" />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── FITUR PER TIER ── */}
          <div className="px-4 pt-6 pb-10">
            <p className="text-[11px] font-bold uppercase tracking-widest mb-5"
              style={{ color: "rgba(255,255,255,0.3)" }}>Fitur per Paket</p>

            <div className="space-y-5">
              {TIER_META.map((tier) => {
                const tierFeatures = PLAN_FEATURES.filter(f => f.minMonths === tier.minMonths);
                return (
                  <div key={tier.minMonths}>
                    {/* Tier label */}
                    <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold mb-3 border ${tier.pill}`}>
                      {tier.minMonths === 12 ? "👑" : tier.minMonths === 1 ? "✦" : "+"} {tier.label}
                    </div>

                    <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
                      {tierFeatures.map((f, i) => (
                        <div key={i}
                          className="flex items-center gap-3.5 px-4 py-3.5 transition-colors"
                          style={{
                            background: i % 2 === 0 ? "rgba(255,255,255,0.03)" : "transparent",
                            borderTop: i > 0 ? "1px solid rgba(255,255,255,0.05)" : "none",
                          }}>
                          {/* Icon dot */}
                          <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                            style={{ background: `${f.accentColor}22`, color: f.accentColor }}>
                            {f.icon}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-bold text-white leading-none">{f.title}</p>
                            <p className="text-xs mt-1 leading-relaxed" style={{ color: "rgba(255,255,255,0.4)" }}>{f.desc}</p>
                          </div>
                          {isPremium && <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: f.accentColor }} />}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Free posting note */}
            <div className="mt-6 rounded-2xl px-4 py-3.5 flex items-start gap-3"
              style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)" }}>
              <Zap className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <p className="text-xs leading-relaxed" style={{ color: "rgba(110,231,183,0.85)" }}>
                <span className="font-bold text-emerald-300">Posting lowongan selalu gratis</span> — Rekhastha Bisnis membuka fitur manajemen karyawan dan tim di atas.
              </p>
            </div>
          </div>
        </>
      )}

      {/* ── CONFIRM / PAY MODAL ── */}
      {(buyStep === "confirm" || buyStep === "paying" || buyStep === "success" || buyStep === "error") && selectedPlan && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={buyStep === "paying" ? undefined : closeModal} />
          <div className="relative z-10 rounded-t-3xl sm:rounded-3xl w-full sm:max-w-sm mx-0 sm:mx-4 p-6 shadow-2xl"
            style={{ background: "#161b22", border: "1px solid rgba(255,255,255,0.1)" }}>

            {buyStep === "success" ? (
              <div className="flex flex-col items-center gap-4 py-4">
                <div className="w-16 h-16 rounded-full flex items-center justify-center"
                  style={{ background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.3)" }}>
                  <CheckCircle2 className="w-9 h-9 text-emerald-400" />
                </div>
                <div className="text-center">
                  <p className="font-black text-white text-xl">Tagihan dibuat</p>
                  <p className="text-sm mt-1.5 leading-relaxed" style={{ color: "rgba(255,255,255,0.5)" }}>
                    Transfer untuk paket <span className="font-semibold text-white">{selectedPlan.label}</span> melalui Pembayaran Manual. Aktif setelah admin konfirmasi.
                  </p>
                </div>
                <button onClick={closeModal}
                  className="w-full font-bold py-3.5 rounded-2xl text-sm text-white"
                  style={{ background: "linear-gradient(135deg, #10b981, #059669)" }}>
                  Selesai
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-2">
                    <Crown className="w-5 h-5 text-amber-400" />
                    <h2 className="font-black text-white text-base">Konfirmasi Berlangganan</h2>
                  </div>
                  {buyStep !== "paying" && (
                    <button onClick={closeModal} style={{ color: "rgba(255,255,255,0.3)" }}>
                      <X className="w-5 h-5" />
                    </button>
                  )}
                </div>

                {/* Plan summary */}
                <div className="rounded-2xl p-4 mb-5 flex items-center justify-between"
                  style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)" }}>
                  <div>
                    <p className="font-bold text-white text-sm">Rekhastha Bisnis {selectedPlan.label}</p>
                    <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>untuk {currentUser.name}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-black text-amber-400 text-lg">{fmt(selectedPlan.promoPrice)}</p>
                    <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>{selectedPlan.durationDays} hari</p>
                  </div>
                </div>

                {/* Features included */}
                <div className="space-y-2.5 mb-5">
                  {PLAN_FEATURES.filter(f => f.minMonths <= Math.round(selectedPlan.durationDays / 30)).map((f, i) => (
                    <div key={i} className="flex items-center gap-2.5">
                      <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                        style={{ background: `${f.accentColor}22`, color: f.accentColor }}>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      </div>
                      <span className="text-xs" style={{ color: "rgba(255,255,255,0.7)" }}>{f.title}</span>
                    </div>
                  ))}
                </div>

                {buyStep === "error" && buyError && (
                  <div className="mb-4 rounded-xl px-3 py-2.5 flex items-start gap-2"
                    style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-red-300">{buyError}</p>
                  </div>
                )}

                <div className="flex gap-3">
                  {buyStep !== "paying" && (
                    <button onClick={closeModal}
                      className="flex-1 font-bold py-3.5 rounded-2xl text-sm"
                      style={{ background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.6)" }}>
                      Batal
                    </button>
                  )}
                  <button
                    onClick={buyStep === "error" || buyStep === "confirm" ? handleBuy : undefined}
                    disabled={buyStep === "paying"}
                    className="flex-1 font-bold py-3.5 rounded-2xl text-sm flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-60"
                    style={{ background: "linear-gradient(135deg, #10b981, #059669)", color: "#fff" }}>
                    {buyStep === "paying" ? (
                      <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Memproses…</>
                    ) : buyStep === "error" ? (
                      <><RefreshCw className="w-4 h-4" /> Coba Lagi</>
                    ) : (
                      <><ArrowRight className="w-4 h-4" /> Bayar {fmt(selectedPlan.promoPrice)}</>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>

    {/* ── MODALS (lazy) ── */}
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
