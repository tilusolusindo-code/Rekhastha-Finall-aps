/**
 * MidtransSnapModal
 *
 * Komponen pembayaran via Midtrans Snap.
 * - Untuk langganan: panggil dengan type="subscription" dan planId
 * - Untuk posting: panggil dengan type="posting" dan jobId
 *
 * Midtrans Snap JS di-load sekali saat komponen mount.
 */
import { useState, useEffect, useRef } from "react";
import { X, CreditCard, AlertCircle, RefreshCw, Loader2 } from "lucide-react";

declare global {
  interface Window {
    snap?: {
      pay: (token: string, options: {
        onSuccess: (result: unknown) => void;
        onPending: (result: unknown) => void;
        onError: (result: unknown) => void;
        onClose: () => void;
      }) => void;
    };
  }
}

interface Props {
  type: "subscription" | "posting";
  planId?: number;
  planLabel?: string;
  jobId?: string | number;
  jobTitle?: string;
  amount: number;
  /** Rincian untuk posting lowongan: upah (escrow) + biaya layanan. */
  breakdown?: { wage: number; fee: number };
  /** Bila diisi, tampil tautan untuk beralih ke transfer bank manual. */
  onUseManual?: () => void;
  onSuccess: () => void;
  onClose: () => void;
}

type Step = "idle" | "loading" | "snap" | "success" | "error" | "pending";

const fmt = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

const SNAP_SCRIPT_ID = "midtrans-snap";
let snapLoading: Promise<void> | null = null;

/**
 * Muat snap.js sekali saja dan tunggu sampai `window.snap` benar-benar ada.
 * (Versi lama langsung resolve jika <script> sudah ada di DOM walau belum
 * selesai dimuat -> window.snap masih undefined -> popup tidak muncul.)
 */
function loadSnapScript(isProduction: boolean): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("Snap hanya bisa dimuat di browser."));
  if (window.snap) return Promise.resolve();
  if (snapLoading) return snapLoading;

  const clientKey = (import.meta.env.VITE_MIDTRANS_CLIENT_KEY ?? "").trim();
  if (!clientKey) {
    return Promise.reject(
      new Error("VITE_MIDTRANS_CLIENT_KEY belum di-set. Isi Client Key Midtrans di environment build lalu deploy ulang."),
    );
  }

  snapLoading = new Promise<void>((resolve, reject) => {
    // Buang tag lama yang gagal/setengah jalan agar bisa dicoba ulang.
    document.getElementById(SNAP_SCRIPT_ID)?.remove();

    const script = document.createElement("script");
    script.id = SNAP_SCRIPT_ID;
    script.src = isProduction
      ? "https://app.midtrans.com/snap/snap.js"
      : "https://app.sandbox.midtrans.com/snap/snap.js";
    script.async = true;
    script.setAttribute("data-client-key", clientKey);
    script.onload = () => {
      if (window.snap) resolve();
      else reject(new Error("snap.js termuat tetapi objek Snap tidak tersedia. Periksa Client Key & mode sandbox/production."));
    };
    script.onerror = () => reject(new Error("Gagal memuat Midtrans Snap (diblokir jaringan/CSP). Muat ulang halaman."));
    document.head.appendChild(script);
  }).catch((e) => {
    snapLoading = null; // izinkan retry
    document.getElementById(SNAP_SCRIPT_ID)?.remove();
    throw e;
  });

  return snapLoading;
}

export default function MidtransSnapModal({
  type, planId, planLabel, jobId, jobTitle, amount, breakdown, onUseManual, onSuccess, onClose,
}: Props) {
  const [step, setStep] = useState<Step>("idle");
  const [errMsg, setErrMsg] = useState("");
  // Ref agar callback Snap (onClose) tidak membaca nilai `step` yang basi.
  const stepRef = useRef<Step>("idle");
  const updateStep = (s: Step) => { stepRef.current = s; setStep(s); };
  const isProduction = import.meta.env.VITE_MIDTRANS_IS_PRODUCTION === "true";

  // Load script saat mount
  useEffect(() => {
    loadSnapScript(isProduction).catch(e => {
      setErrMsg(e.message);
      updateStep("error");
    });
  }, [isProduction]);

  async function handlePay() {
    updateStep("loading");
    setErrMsg("");

    try {
      // 1. Minta token dari backend
      const endpoint = type === "subscription"
        ? "/api/payments/midtrans/snap/subscription"
        : "/api/payments/midtrans/snap/posting";

      const body = type === "subscription"
        ? { planId }
        : { jobId };

      const res = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) throw new Error(data.error ?? "Gagal membuat sesi pembayaran.");

      // Subscriber — langsung aktif tanpa Snap
      if (data.waived) {
        updateStep("success");
        setTimeout(onSuccess, 1500);
        return;
      }

      // 2. Pastikan Snap script sudah load
      await loadSnapScript(isProduction);
      if (!window.snap) throw new Error("Midtrans Snap belum siap. Muat ulang halaman.");

      updateStep("snap");

      // 3. Buka popup Snap
      window.snap.pay(data.snapToken, {
        onSuccess: () => {
          updateStep("success");
          setTimeout(onSuccess, 1500);
        },
        onPending: () => {
          updateStep("pending");
        },
        onError: () => {
          setErrMsg("Pembayaran gagal. Coba metode lain.");
          updateStep("error");
        },
        onClose: () => {
          // User tutup popup tanpa bayar
          if (stepRef.current === "snap") updateStep("idle");
        },
      });
    } catch (err) {
      setErrMsg((err as Error).message);
      updateStep("error");
    }
  }

  const title = type === "subscription"
    ? `Rekhastha Bisnis ${planLabel ?? ""}`
    : `Posting: ${jobTitle ?? "Lowongan"}`;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={step === "loading" || step === "snap" ? undefined : onClose} />

      <div className="relative z-10 bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-sm mx-0 sm:mx-4 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100">
          <div>
            <h2 className="font-black text-gray-900 text-base">Bayar via Midtrans</h2>
            <p className="text-xs text-gray-400 mt-0.5 truncate max-w-[220px]">{title}</p>
          </div>
          {step !== "loading" && step !== "snap" && (
            <button onClick={onClose} className="text-gray-400 p-1"><X className="w-5 h-5" /></button>
          )}
        </div>

        {/* Amount */}
        <div className="px-5 py-3 bg-blue-50 border-b border-blue-100">
          <div className="flex justify-between items-center">
            <span className="text-sm text-blue-700 font-semibold">Total</span>
            <span className="text-xl font-black text-blue-700">{fmt(amount)}</span>
          </div>
          {breakdown && (
            <div className="mt-2 space-y-0.5 text-[11px] text-blue-600">
              <div className="flex justify-between"><span>Upah pekerja (escrow)</span><span>{fmt(breakdown.wage)}</span></div>
              <div className="flex justify-between">
                <span>Biaya layanan posting</span>
                <span>{breakdown.fee > 0 ? fmt(breakdown.fee) : "Gratis"}</span>
              </div>
            </div>
          )}
        </div>

        {/* Body */}
        <div className="px-5 py-5 space-y-4">
          {/* SUCCESS */}
          {step === "success" && (
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center text-2xl">✅</div>
              <p className="font-black text-gray-900">Pembayaran Berhasil!</p>
              <p className="text-xs text-gray-400 text-center">
                {type === "subscription"
                  ? "Rekhastha Bisnis Anda sudah aktif."
                  : "Lowongan Anda sudah tayang dan dana upah terkunci di escrow."}
              </p>
            </div>
          )}

          {/* PENDING */}
          {step === "pending" && (
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center text-2xl">⏳</div>
              <p className="font-black text-gray-900">Menunggu Pembayaran</p>
              <p className="text-xs text-gray-400 text-center">
                Selesaikan pembayaran sesuai instruksi. Layanan aktif otomatis setelah dikonfirmasi.
              </p>
              <button onClick={onClose} className="text-sm text-blue-600 font-semibold">Tutup</button>
            </div>
          )}

          {/* ERROR */}
          {step === "error" && (
            <>
              <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-3 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <p className="text-xs text-red-600">{errMsg}</p>
              </div>
              <button
                onClick={handlePay}
                className="w-full bg-blue-600 text-white font-black py-4 rounded-2xl text-sm flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" /> Coba Lagi
              </button>
            </>
          )}

          {/* SNAP terbuka — user lagi di popup */}
          {step === "snap" && (
            <div className="flex flex-col items-center gap-3 py-6">
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
              <p className="text-sm text-gray-500">Selesaikan pembayaran di popup Midtrans…</p>
            </div>
          )}

          {/* IDLE / LOADING — tombol bayar */}
          {(step === "idle" || step === "loading") && (
            <>
              <div className="bg-gray-50 rounded-xl px-4 py-3 space-y-2">
                <p className="text-xs font-bold text-gray-700">Metode pembayaran tersedia:</p>
                <div className="flex flex-wrap gap-1.5">
                  {["VA BCA","VA BNI","VA BRI","VA Mandiri","QRIS","Kartu Kredit","Indomaret","Alfamart"].map(m => (
                    <span key={m} className="text-[10px] bg-white border border-gray-200 rounded px-2 py-0.5 text-gray-500">{m}</span>
                  ))}
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-100 rounded-xl px-3 py-2.5 flex items-start gap-2">
                <CreditCard className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                <p className="text-xs text-blue-600 leading-relaxed">
                  Pembayaran diproses Midtrans · Aman &amp; terenkripsi · Layanan aktif otomatis setelah pembayaran dikonfirmasi
                </p>
              </div>

              <button
                onClick={handlePay}
                disabled={step === "loading"}
                className={`w-full font-black py-4 rounded-2xl text-sm flex items-center justify-center gap-2 transition-all ${
                  step === "loading"
                    ? "bg-blue-400 text-white cursor-not-allowed"
                    : "bg-blue-600 text-white active:scale-95"
                }`}
              >
                {step === "loading" ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Menyiapkan…</>
                ) : (
                  <><CreditCard className="w-4 h-4" /> Bayar {fmt(amount)}</>
                )}
              </button>
              {onUseManual && step === "idle" && (
                <button
                  type="button"
                  onClick={onUseManual}
                  className="w-full text-center text-xs font-semibold text-gray-500 underline underline-offset-2"
                >
                  Lebih suka transfer bank manual
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
