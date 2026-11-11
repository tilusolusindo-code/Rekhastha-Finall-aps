/**
 * MidtransReturnHandler
 *
 * Setelah pelanggan membayar di halaman Midtrans, backend mengarahkan
 * kembali ke:
 *   ${APP_BASE}/?payment=success|failed|pending&order=<orderId>&type=subscription|posting
 * (lihat `callbacks.finish/error/pending` di routes/midtrans.ts)
 *
 * Komponen ini membaca parameter itu, MENANYAKAN STATUS SEBENARNYA ke
 * `GET /api/payments/midtrans/status/:orderId` (parameter URL hasil redirect
 * tidak pernah dipercaya begitu saja — webhook mungkin belum sampai saat
 * `finish` callback dipanggil), lalu menampilkan hasilnya dan membersihkan
 * URL supaya tidak terpicu ulang saat halaman di-refresh.
 *
 * CARA PASANG: import dan render sekali saja di dekat root halaman utama
 * (mis. di `pages/home.tsx`, sebagai saudara dari konten lain yang sudah
 * ada):
 *
 *   import MidtransReturnHandler from "../components/midtrans-return-handler";
 *   ...
 *   return (
 *     <>
 *       <MidtransReturnHandler />
 *       { ...JSX yang sudah ada... }
 *     </>
 *   );
 *
 * Tidak perlu prop apa pun. Tidak merender apa-apa kalau tidak ada
 * parameter `?payment=...` di URL.
 */
import { useEffect, useState, type ReactElement } from "react";
import { CheckCircle2, Clock3, XCircle, X } from "lucide-react";

type Outcome = "checking" | "success" | "pending" | "failed" | "unknown";

export default function MidtransReturnHandler() {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [label, setLabel] = useState<string>("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paymentParam = params.get("payment"); // success | pending | failed
    let orderId = params.get("order");
    if (!paymentParam) return;

    // Fallback kalau `order` entah kenapa hilang dari URL (mis. dipotong proxy).
    if (!orderId) {
      try {
        orderId = sessionStorage.getItem("rekhastha_last_midtrans_order");
      } catch {
        orderId = null;
      }
    }

    // Bersihkan URL SEGERA supaya refresh halaman tidak memicu ulang alur ini.
    window.history.replaceState(null, "", window.location.pathname);

    if (!orderId) {
      setOutcome(paymentParam === "success" ? "success" : paymentParam === "pending" ? "pending" : "failed");
      return;
    }

    let cancelled = false;
    setOutcome("checking");

    (async () => {
      // Webhook Midtrans bisa datang beberapa detik setelah redirect selesai —
      // coba beberapa kali sebelum menyerah ke status dari URL saja.
      for (let attempt = 0; attempt < 6 && !cancelled; attempt += 1) {
        try {
          const res = await fetch(`/api/payments/midtrans/status/${encodeURIComponent(orderId)}`, {
            credentials: "same-origin",
          });
          if (res.ok) {
            const data = await res.json();
            const status = String(data?.order?.status ?? "").toLowerCase();
            setLabel(String(data?.order?.label ?? ""));
            if (status === "paid" || status === "confirmed") {
              if (!cancelled) setOutcome("success");
              return;
            }
            if (status === "pending") {
              if (!cancelled) setOutcome("pending");
              // tetap coba lagi beberapa kali, siapa tahu sudah diproses webhook
            }
          }
        } catch {
          // abaikan, coba lagi
        }
        await new Promise((r) => window.setTimeout(r, 2000));
      }
      if (!cancelled) {
        setOutcome((prev) =>
          prev === "pending" ? "pending" : paymentParam === "success" ? "success" : "unknown",
        );
      }
    })();

    try {
      sessionStorage.removeItem("rekhastha_last_midtrans_order");
    } catch {
      // tidak fatal
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!outcome) return null;

  const content: Record<Outcome, { icon: ReactElement; title: string; body: string; tone: string }> = {
    checking: {
      icon: <Clock3 className="w-6 h-6 text-blue-500 animate-pulse" />,
      title: "Memeriksa status pembayaran…",
      body: "Mohon tunggu sebentar.",
      tone: "bg-blue-50 border-blue-100",
    },
    success: {
      icon: <CheckCircle2 className="w-6 h-6 text-emerald-500" />,
      title: "Pembayaran berhasil",
      body: label ? `${label} sudah aktif.` : "Layanan Anda sudah aktif.",
      tone: "bg-emerald-50 border-emerald-100",
    },
    pending: {
      icon: <Clock3 className="w-6 h-6 text-amber-500" />,
      title: "Menunggu pembayaran",
      body: "Selesaikan pembayaran sesuai instruksi. Layanan aktif otomatis setelah dikonfirmasi.",
      tone: "bg-amber-50 border-amber-100",
    },
    failed: {
      icon: <XCircle className="w-6 h-6 text-red-500" />,
      title: "Pembayaran gagal",
      body: "Silakan coba lagi atau gunakan transfer bank manual.",
      tone: "bg-red-50 border-red-100",
    },
    unknown: {
      icon: <Clock3 className="w-6 h-6 text-gray-400" />,
      title: "Status belum dapat dipastikan",
      body: "Status akan diperbarui otomatis begitu pembayaran dikonfirmasi. Muat ulang halaman beberapa saat lagi.",
      tone: "bg-gray-50 border-gray-200",
    },
  };

  const { icon, title, body, tone } = content[outcome];

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] w-[92%] max-w-sm">
      <div className={`rounded-2xl border shadow-lg px-4 py-3 flex items-start gap-3 ${tone}`}>
        {icon}
        <div className="flex-1 min-w-0">
          <p className="font-black text-sm text-gray-900">{title}</p>
          <p className="text-xs text-gray-600 mt-0.5">{body}</p>
        </div>
        {outcome !== "checking" && (
          <button onClick={() => setOutcome(null)} className="text-gray-400 p-1 shrink-0">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
