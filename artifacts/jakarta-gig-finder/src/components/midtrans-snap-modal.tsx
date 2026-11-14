/**
 * MidtransSnapModal
 *
 * Komponen pembayaran via Midtrans.
 * - Untuk langganan: panggil dengan type="subscription" dan planId
 * - Untuk posting: panggil dengan type="posting" dan jobId
 *
 * PERUBAHAN: sebelumnya memuat Snap JS (`snap.js`) dari domain Midtrans dan
 * membuka pop-up di tempat. Itu butuh CSP `script-src` melonggarkan domain
 * Midtrans, dan gagal (lihat `loadSnapScript`) kalau CSP tidak diubah — ini
 * persis error "Gagal memuat Midtrans Snap (diblokir jaringan/CSP)" yang
 * muncul di produksi.
 *
 * Sekarang memakai REDIRECT: backend (`routes/midtrans.ts`) sudah
 * mengembalikan `redirectUrl` di kedua endpoint (`snap/subscription` dan
 * `snap/posting`), jadi kita tinggal mengarahkan browser ke sana. Tidak ada
 * script eksternal yang dimuat sama sekali → tidak perlu mengubah CSP.
 *
 * Saat pengguna kembali dari Midtrans, backend sudah menyiapkan
 * `callbacks.finish/error/pending` yang mengarah ke
 * `${APP_BASE}/?payment=success&order=...&type=...` (lihat routes/midtrans.ts).
 * Penanganannya ada di komponen terpisah `midtrans-return-handler.tsx` —
 * pasang sekali di root halaman (lihat komentar di file itu).
 */
import { useState } from "react";
import { X, CreditCard, AlertCircle, RefreshCw, Loader2 } from "lucide-react";

interface Props {
  type: "subscription" | "posting";
  planId?: number;
  planLabel?: string;
  jobId?: string | number;
  jobTitle?: string;
  amount: number;
  /** Rincian untuk posting lowongan: upah (escrow) + biaya layanan. */
  breakdown?: { wage: number; fee: number };
  onSuccess: () => void;
  onClose: () => void;
}

type Step = "idle" | "loading" | "redirecting" | "error";

const fmt = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export default function MidtransSnapModal({
  type, planId, planLabel, jobId, jobTitle, amount, breakdown, onClose,
}: Props) {
  const [step, setStep] = useState<Step>("idle");
  const [errMsg, setErrMsg] = useState("");

  async function handlePay() {
    setStep("loading");
    setErrMsg("");

    try {
      const endpoint = type === "subscription"
        ? "/api/payments/midtrans/snap/subscription"
        : "/api/payments/midtrans/snap/posting";

      const body = type === "subscription" ? { planId } : { jobId };

      const res = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) throw new Error(data.error ?? "Gagal membuat sesi pembayaran.");

      // Subscriber yang sudah ditanggung paket lain — langsung aktif tanpa redirect.
      if (data.waived) {
        setStep("idle");
        onClose();
        return;
      }

      if (typeof data.redirectUrl !== "string" || !data.redirectUrl) {
        throw new Error("Server tidak mengembalikan halaman pembayaran. Hubungi admin.");
      }

      setStep("redirecting");
      // Simpan orderId secara lokal agar halaman kembalian (?payment=...) bisa
      // menampilkan hasil yang tepat walau query param ternyata tidak lengkap.
      try {
        sessionStorage.setItem("rekhastha_last_midtrans_order", data.orderId ?? "");
      } catch {
        // sessionStorage bisa saja diblokir (mode privat) — tidak fatal.
      }
      window.location.href = data.redirectUrl;
    } catch (err) {
      setErrMsg((err as Error).message);
      setStep("error");
    }
  }

  const title = type === "subscription"
    ? `Rekhastha Bisnis ${planLabel ?? ""}`
    : `Posting: ${jobTitle ?? "Lowongan"}`;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={step === "loading" || step === "redirecting" ? undefined : onClose}
      />

      <div className="relative z-10 bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-sm mx-0 sm:mx-4 shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100">
          <div>
            <h2 className="font-black text-gray-900 text-base">Bayar via Midtrans</h2>
            <p className="text-xs text-gray-500 mt-0.5 truncate max-w-[220px]">{title}</p>
          </div>
          {step !== "loading" && step !== "redirecting" && (
            <button onClick={onClose} className="text-gray-500 p-1"><X className="w-5 h-5" /></button>
          )}
        </div>

        <div className="px-5 py-3 bg-blue-50 border-b border-blue-100">
          <div className="flex justify-between items-center">
            <span className="text-sm text-blue-700 font-semibold">Total</span>
            <span className="text-xl font-black text-blue-700">{fmt(amount)}</span>
          </div>
          {breakdown && (
            <div className="mt-2 space-y-0.5 text-[12px] text-blue-600">
              <div className="flex justify-between"><span>Upah pekerja (escrow)</span><span>{fmt(breakdown.wage)}</span></div>
              <div className="flex justify-between">
                <span>Biaya layanan posting</span>
                <span>{breakdown.fee > 0 ? fmt(breakdown.fee) : "Gratis"}</span>
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-5 space-y-4">
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

          {step === "redirecting" && (
            <div className="flex flex-col items-center gap-3 py-6">
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
              <p className="text-sm text-gray-500">Mengarahkan ke halaman pembayaran Midtrans…</p>
            </div>
          )}

          {(step === "idle" || step === "loading") && (
            <>
              <div className="bg-gray-50 rounded-xl px-4 py-3 space-y-2">
                <p className="text-xs font-bold text-gray-700">Metode pembayaran tersedia:</p>
                <div className="flex flex-wrap gap-1.5">
                  {["VA BCA","VA BNI","VA BRI","VA Mandiri","QRIS","Kartu Kredit","Indomaret","Alfamart"].map(m => (
                    <span key={m} className="text-[11px] bg-white border border-gray-200 rounded px-2 py-0.5 text-gray-500">{m}</span>
                  ))}
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-100 rounded-xl px-3 py-2.5 flex items-start gap-2">
                <CreditCard className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                <p className="text-xs text-blue-600 leading-relaxed">
                  Anda akan diarahkan ke halaman pembayaran Midtrans · Aman &amp; terenkripsi · Layanan aktif otomatis setelah pembayaran dikonfirmasi
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
