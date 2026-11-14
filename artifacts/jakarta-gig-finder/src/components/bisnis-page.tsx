import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import { TeamMemberBisnisView } from "./team-membership-banner";
import { AuthUser } from "@/types/auth";
import MidtransSnapModal from "./midtrans-snap-modal";
import {
  fetchSubscriptionPlans,
  fetchBisnisStatus,
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

// ── Fitur yang ditampilkan di konfirmasi paket (per jumlah bulan minimum) ──
const PLAN_FEATURES: { title: string; minMonths: number }[] = [
  { title: "QR Presensi GPS", minMonths: 1 },
  { title: "Kalkulator Gaji Harian", minMonths: 1 },
  { title: "Kontak Pelamar Tanpa Batas", minMonths: 1 },
  { title: "Badge Terverifikasi", minMonths: 1 },
  { title: "Posting Prioritas", minMonths: 3 },
  { title: "Statistik Lamaran Detail", minMonths: 3 },
  { title: "Undang Pekerja Favorit", minMonths: 6 },
  { title: "Laporan Kehadiran PDF", minMonths: 6 },
  { title: "Multi-Cabang & Tim", minMonths: 12 },
  { title: "Kalkulasi Potongan Pajak", minMonths: 12 },
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

  // Buka modal Midtrans Snap untuk membayar paket langganan.
  function handleBuy() {
    if (!selectedPlan) return;
    setBuyError("");
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
    void load(); // muat ulang status langganan setelah bayar
  }

  const expiredAt    = status?.expiredAt ? new Date(status.expiredAt) : null;
  const isPremium    = status?.isPremium ?? false;
  const bestValuePlan = plans.reduce<SubscriptionPlan | null>((best, p) => {
    if (!best) return p;
    return (p.promoPrice / p.durationDays) < (best.promoPrice / best.durationDays) ? p : best;
  }, null);

  // ── Kalau user adalah anggota tim, tampilkan view khusus ──────────────────
  if (membershipLoaded && membership) {
    return <TeamMemberBisnisView memberships={[membership]} />;
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  const card = "bg-white rounded-2xl border border-gray-100 shadow-sm";
  return (
    <>
    <div className="flex-1 overflow-y-auto bg-gray-50">

      {/* ── HEADER ── */}
      <div className="px-5 pt-6 pb-4">
        <h1 className="text-gray-900 font-black text-2xl tracking-tight leading-tight">Rekhastha Bisnis</h1>
        <p className="text-gray-500 text-sm mt-1">Manajemen pekerja harian untuk perusahaan Anda</p>

        {!loading && status && (
          isPremium ? (
            <div className="mt-4 rounded-2xl px-5 py-4 bg-primary/5 border border-primary/20">
              <p className="text-primary font-black text-base leading-none">Premium Aktif</p>
              {expiredAt && (
                <p className="text-gray-600 text-sm mt-1.5">
                  Aktif hingga {expiredAt.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}
                </p>
              )}
              <div className="flex gap-2 mt-4">
                <button onClick={() => setShowTax(true)}
                  className="px-4 py-2.5 rounded-xl text-sm font-bold bg-primary text-white active:scale-95 transition-transform">
                  Hitung Pajak
                </button>
                <button onClick={() => setShowTeam(true)}
                  className="px-4 py-2.5 rounded-xl text-sm font-bold bg-white text-primary border border-primary/30 active:scale-95 transition-transform">
                  Kelola Tim
                </button>
              </div>
            </div>
          ) : (
            <div className={`mt-4 px-5 py-4 ${card}`}>
              <p className="text-gray-900 font-bold text-sm">Belum Berlangganan</p>
              <p className="text-gray-500 text-sm mt-0.5">Pilih paket di bawah untuk mulai</p>
            </div>
          )
        )}
      </div>

      {/* ── LOADING / ERROR ── */}
      {loading && (
        <div className="flex flex-col items-center justify-center gap-3 py-24">
          <span className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Memuat paket…</p>
        </div>
      )}
      {!loading && loadError && (
        <div className="mx-5 mb-5 rounded-2xl px-4 py-4 bg-red-50 border border-red-200">
          <p className="text-sm font-semibold text-red-700">Gagal memuat</p>
          <p className="text-sm text-red-600 mt-0.5">{loadError}</p>
          <button onClick={load} className="mt-2 text-sm font-bold text-red-700">Coba Lagi</button>
        </div>
      )}

      {!loading && !loadError && (
        <div className="px-4 pt-2 pb-10">
          <p className="text-[12px] font-bold uppercase tracking-widest mb-3 text-gray-500">Pilih Paket</p>

          <div className="grid grid-cols-2 gap-3">
            {plans.map((plan) => {
              const isBest   = bestValuePlan?.id === plan.id;
              const perDay   = Math.round(plan.promoPrice / plan.durationDays);
              const discount = Math.round(((plan.originalPrice - plan.promoPrice) / plan.originalPrice) * 100);
              return (
                <button key={plan.id} onClick={() => handleSelectPlan(plan)}
                  className={`relative text-left rounded-2xl p-4 transition-all active:scale-95 bg-white shadow-sm ${
                    isBest ? "border-2 border-primary" : "border border-gray-200"
                  }`}>
                  {isBest && (
                    <span className="absolute -top-2.5 left-4 text-[11px] font-black px-2.5 py-0.5 rounded-full bg-primary text-white">
                      TERBAIK
                    </span>
                  )}

                  <p className="font-black text-sm leading-tight text-gray-900">{plan.label}</p>
                  <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                    <span className="text-[12px] font-medium text-gray-500">{plan.durationDays} hari</span>
                    {discount > 0 && (
                      <span className="text-[11px] font-black px-1.5 py-0.5 rounded-full bg-red-50 text-red-600">-{discount}%</span>
                    )}
                  </div>

                  <div className="mt-3">
                    <p className="text-[12px] line-through leading-none text-gray-400">{fmt(plan.originalPrice)}</p>
                    <p className="font-black text-lg leading-tight text-primary mt-1">{fmt(plan.promoPrice)}</p>
                    <p className="text-[12px] mt-0.5 text-gray-500">~{fmt(perDay)}/hari</p>
                  </div>

                  <p className="mt-3 text-sm font-bold text-primary">Pilih</p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── CONFIRM / PAY MODAL ── */}
      {!showSnap && (buyStep === "confirm" || buyStep === "paying" || buyStep === "success" || buyStep === "error") && selectedPlan && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          <div className="absolute inset-0 bg-black/50" onClick={buyStep === "paying" ? undefined : closeModal} />
          <div className="relative z-10 rounded-t-3xl sm:rounded-3xl w-full sm:max-w-sm mx-0 sm:mx-4 p-6 shadow-2xl bg-white">

            {buyStep === "success" ? (
              <div className="flex flex-col items-center gap-4 py-4 text-center">
                <p className="font-black text-gray-900 text-xl">Pembayaran diterima</p>
                <p className="text-sm leading-relaxed text-gray-600">
                  Paket <span className="font-semibold text-gray-900">{selectedPlan.label}</span> dibayar lewat Midtrans. Status Rekhastha Bisnis Anda diperbarui otomatis setelah pembayaran terkonfirmasi.
                </p>
                <button onClick={closeModal}
                  className="w-full font-bold py-3.5 rounded-2xl text-sm text-white bg-primary">
                  Selesai
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-black text-gray-900 text-base">Konfirmasi Berlangganan</h2>
                  {buyStep !== "paying" && (
                    <button onClick={closeModal} className="text-sm font-semibold text-gray-500 px-2 py-1">Tutup</button>
                  )}
                </div>

                <div className="rounded-2xl p-4 mb-4 flex items-center justify-between gap-3 bg-primary/5 border border-primary/20">
                  <div className="min-w-0">
                    <p className="font-bold text-gray-900 text-sm">Rekhastha Bisnis {selectedPlan.label}</p>
                    <p className="text-[12px] mt-0.5 text-gray-500">untuk {currentUser.name}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-black text-primary text-lg whitespace-nowrap">{fmt(selectedPlan.promoPrice)}</p>
                    <p className="text-[12px] text-gray-500">{selectedPlan.durationDays} hari</p>
                  </div>
                </div>

                <div className="space-y-2 mb-5">
                  {PLAN_FEATURES.filter(f => f.minMonths <= Math.round(selectedPlan.durationDays / 30)).map((f) => (
                    <div key={f.title} className="flex items-center gap-2.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                      <span className="text-[13px] text-gray-700">{f.title}</span>
                    </div>
                  ))}
                </div>

                {buyStep === "error" && buyError && (
                  <div className="mb-4 rounded-xl px-3 py-2.5 bg-red-50 border border-red-200">
                    <p className="text-sm text-red-700">{buyError}</p>
                  </div>
                )}

                <div className="flex gap-3">
                  {buyStep !== "paying" && (
                    <button onClick={closeModal}
                      className="flex-1 font-bold py-3.5 rounded-2xl text-sm bg-gray-100 text-gray-700">
                      Batal
                    </button>
                  )}
                  <button
                    onClick={buyStep === "error" || buyStep === "confirm" ? handleBuy : undefined}
                    disabled={buyStep === "paying"}
                    className="flex-1 font-bold py-3.5 rounded-2xl text-sm flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-60 bg-primary text-white">
                    {buyStep === "paying" ? (
                      <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Memproses…</>
                    ) : buyStep === "error" ? (
                      "Coba Lagi"
                    ) : (
                      <>Bayar {fmt(selectedPlan.promoPrice)}</>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>

    {/* ── Midtrans Snap (langganan) ── */}
    {showSnap && selectedPlan && (
      <MidtransSnapModal
        type="subscription"
        planId={selectedPlan.id}
        planLabel={selectedPlan.label}
        amount={selectedPlan.promoPrice}
        onSuccess={handleSnapSuccess}
        onClose={() => { setShowSnap(false); setBuyStep("confirm"); }}
      />
    )}

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
