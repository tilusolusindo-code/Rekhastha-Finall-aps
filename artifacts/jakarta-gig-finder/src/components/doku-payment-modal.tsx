/**
 * Modal pembayaran DOKU — tampil saat employer pilih paket Rekhastha Bisnis.
 * User pilih metode (VA BNI, BRI, BSI, dll) → redirect ke checkout DOKU.
 */
import { useState } from "react";
import { X, CreditCard, AlertCircle, RefreshCw, ExternalLink, Building2 } from "lucide-react";

interface DokuPaymentModalProps {
  planId: number;
  planLabel: string;
  amount: number;
  onClose: () => void;
}

const VA_CHANNELS = [
  { id: "",                        label: "Semua Metode (Payment Link)", sublabel: "Kartu kredit, VA, QRIS, dll", color: "bg-red-500" },
  { id: "VIRTUAL_ACCOUNT_BNI",    label: "Virtual Account BNI",          sublabel: "Transfer via BNI",           color: "bg-orange-500" },
  { id: "VIRTUAL_ACCOUNT_BRI",    label: "Virtual Account BRI",          sublabel: "Transfer via BRI",           color: "bg-blue-700" },
  { id: "VIRTUAL_ACCOUNT_BSI",    label: "Virtual Account BSI",          sublabel: "Transfer via BSI Syariah",   color: "bg-green-700" },
  { id: "VIRTUAL_ACCOUNT_CIMB",   label: "Virtual Account CIMB",         sublabel: "Transfer via CIMB Niaga",    color: "bg-red-700" },
  { id: "VIRTUAL_ACCOUNT_BJB",    label: "Virtual Account BJB",          sublabel: "Transfer via Bank BJB",      color: "bg-blue-500" },
  { id: "VIRTUAL_ACCOUNT_BNC",    label: "Virtual Account BNC",          sublabel: "Transfer via Neobank",       color: "bg-teal-600" },
  { id: "VIRTUAL_ACCOUNT_BTN",    label: "Virtual Account BTN",          sublabel: "Transfer via BTN",           color: "bg-yellow-600" },
];

const fmt = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

type Step = "pick" | "loading" | "error";

export default function DokuPaymentModal({ planId, planLabel, amount, onClose }: DokuPaymentModalProps) {
  const [step, setStep]       = useState<Step>("pick");
  const [errMsg, setErrMsg]   = useState("");
  const [selected, setSelected] = useState<string>("");

  async function handlePay() {
    setStep("loading");
    setErrMsg("");
    try {
      const res = await fetch("/api/doku/create", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, channel: selected || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Gagal membuat pembayaran.");

      // Redirect ke halaman checkout DOKU
      window.location.href = data.checkoutUrl;
    } catch (err) {
      setErrMsg((err as Error).message);
      setStep("error");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={step === "loading" ? undefined : onClose} />
      <div className="relative z-10 bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md mx-0 sm:mx-4 shadow-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="font-black text-gray-900 text-base">Bayar via DOKU</h2>
            <p className="text-xs text-gray-500 mt-0.5">Rekhastha Bisnis · {planLabel}</p>
          </div>
          {step !== "loading" && (
            <button onClick={onClose} className="text-gray-500 hover:text-gray-600 p-1">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Amount */}
        <div className="px-5 py-3 bg-emerald-50 border-b border-emerald-100 shrink-0">
          <div className="flex items-center justify-between">
            <span className="text-sm text-emerald-700 font-semibold">Total Pembayaran</span>
            <span className="text-xl font-black text-emerald-700">{fmt(amount)}</span>
          </div>
        </div>

        {/* Channel picker */}
        {(step === "pick" || step === "error") && (
          <div className="overflow-y-auto flex-1 px-4 py-3">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Pilih Metode Bayar</p>
            <div className="space-y-2">
              {VA_CHANNELS.map((ch) => (
                <button
                  key={ch.id}
                  onClick={() => setSelected(ch.id)}
                  className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl border-2 text-left transition-all ${
                    selected === ch.id
                      ? "border-emerald-500 bg-emerald-50"
                      : "border-gray-100 bg-white hover:border-gray-200"
                  }`}
                >
                  <div className={`w-9 h-9 rounded-lg ${ch.color} flex items-center justify-center shrink-0`}>
                    <Building2 className="w-4 h-4 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900 leading-tight">{ch.label}</p>
                    <p className="text-[12px] text-gray-500">{ch.sublabel}</p>
                  </div>
                  <div className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
                    selected === ch.id ? "border-emerald-500 bg-emerald-500" : "border-gray-300"
                  }`}>
                    {selected === ch.id && <div className="w-2 h-2 rounded-full bg-white" />}
                  </div>
                </button>
              ))}
            </div>

            {step === "error" && errMsg && (
              <div className="mt-3 rounded-xl bg-red-50 border border-red-100 px-3 py-2.5 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <p className="text-xs text-red-600">{errMsg}</p>
              </div>
            )}

            <div className="mt-3 rounded-xl bg-blue-50 border border-blue-100 px-3 py-2.5 flex items-start gap-2">
              <CreditCard className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
              <p className="text-xs text-blue-600 leading-relaxed">
                Anda akan diarahkan ke halaman pembayaran DOKU yang aman. Langganan aktif otomatis setelah pembayaran dikonfirmasi.
              </p>
            </div>
          </div>
        )}

        {/* Loading */}
        {step === "loading" && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 py-10 px-5">
            <div className="w-14 h-14 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            <div className="text-center">
              <p className="font-bold text-gray-900">Menyiapkan pembayaran…</p>
              <p className="text-xs text-gray-500 mt-1">Anda akan diarahkan ke halaman DOKU</p>
            </div>
          </div>
        )}

        {/* CTA Button */}
        {(step === "pick" || step === "error") && (
          <div className="px-4 pb-5 pt-3 border-t border-gray-100 shrink-0">
            <button
              onClick={step === "error" ? handlePay : handlePay}
              className="w-full bg-emerald-600 text-white font-black py-4 rounded-2xl text-sm flex items-center justify-center gap-2 active:scale-95 transition-all"
            >
              {step === "error" ? (
                <><RefreshCw className="w-4 h-4" /> Coba Lagi</>
              ) : (
                <><ExternalLink className="w-4 h-4" /> Bayar {fmt(amount)} via DOKU</>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
