/**
 * MidtransSnapModal — pays one server-side bill through Midtrans Snap.
 *
 *  - type="subscription"  planId            → Rekhastha Bisnis plan
 *  - type="posting"       jobId             → wage escrow + fee of a job posting
 *  - type="payment"       manualPaymentId   → any open bill from "Pembayaran"
 *
 * The browser never decides how much to charge. The API answers with the Snap
 * token AND the client key + snap.js URL for the mode it is really running in,
 * so no VITE_MIDTRANS_* variable is needed and the keys, the mode and the script
 * can never disagree.
 *
 * What the modal guarantees (these were the failure modes of the old version):
 *  - snap.js is loaded once, and we wait until `window.snap` really exists.
 *    A failed or blocked load is reported, can be retried, and never leaves a
 *    dead <script> tag that later claims "already loaded".
 *  - After Snap reports success we do not just trust the popup: we ask the API
 *    until the payment is really applied (the webhook may be a few seconds late).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { X, CreditCard, AlertCircle, RefreshCw, Loader2 } from "lucide-react";

type SnapCallbacks = {
  onSuccess?: (result: unknown) => void;
  onPending?: (result: unknown) => void;
  onError?: (result: unknown) => void;
  onClose?: () => void;
};

declare global {
  interface Window {
    snap?: { pay: (token: string, options: SnapCallbacks) => void };
  }
}

type BaseProps = {
  /** Shown until the server confirms the real amount. */
  amount: number;
  onSuccess: () => void;
  onClose: () => void;
};
type Props = BaseProps &
  (
    | { type: "subscription"; planId: number; planLabel?: string }
    | { type: "posting"; jobId: string | number; jobTitle?: string }
    | { type: "payment"; manualPaymentId: number; title?: string }
  );

type Step = "idle" | "loading" | "snap" | "verifying" | "success" | "pending" | "review" | "error";

type SnapOrder = {
  snapToken: string;
  orderId: string;
  amount: number;
  clientKey: string;
  snapJsUrl: string;
};

const fmt = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

const SNAP_HOSTS = new Set(["app.midtrans.com", "app.sandbox.midtrans.com"]);
const SCRIPT_ID = "midtrans-snap-js";
const LOAD_TIMEOUT_MS = 15_000;

let loading: { key: string; promise: Promise<void> } | null = null;

/**
 * Loads snap.js for the given URL + client key and resolves only once
 * `window.snap` exists. Concurrent callers share one load.
 */
export function loadSnapScript(snapJsUrl: string, clientKey: string): Promise<void> {
  let host = "";
  try {
    const url = new URL(snapJsUrl);
    if (url.protocol === "https:") host = url.hostname;
  } catch {
    /* handled below */
  }
  // Never inject a script URL we did not expect, even if the API were spoofed.
  if (!SNAP_HOSTS.has(host)) {
    return Promise.reject(new Error("Alamat Midtrans Snap dari server tidak valid."));
  }

  const key = `${snapJsUrl}|${clientKey}`;
  if (window.snap && loading?.key === key) return Promise.resolve();
  if (loading?.key === key) return loading.promise;

  // A previous script (other mode/key, or one that never finished): start clean.
  document.getElementById(SCRIPT_ID)?.remove();
  delete window.snap;

  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = snapJsUrl;
    script.async = true;
    // Snap reads the key when the script runs, so it must be set before append.
    script.setAttribute("data-client-key", clientKey);

    const fail = (message: string) => {
      window.clearTimeout(timer);
      script.remove();
      if (loading?.key === key) loading = null;
      reject(new Error(message));
    };
    const timer = window.setTimeout(
      () => fail("Midtrans Snap terlalu lama dimuat. Periksa koneksi internet Anda."),
      LOAD_TIMEOUT_MS,
    );
    script.onload = () => {
      window.clearTimeout(timer);
      if (window.snap) resolve();
      else fail("Midtrans Snap termuat tetapi tidak siap. Muat ulang halaman.");
    };
    script.onerror = () =>
      fail("Gagal memuat Midtrans Snap. Periksa koneksi internet, ad-blocker, atau pembatasan jaringan.");
    document.head.appendChild(script);
  });
  loading = { key, promise };
  return promise;
}

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

type OrderStatus = { status: string; manualPaymentStatus: string | null };

async function fetchOrderStatus(orderId: string): Promise<OrderStatus | null> {
  try {
    const res = await fetch(`/api/payments/midtrans/status/${encodeURIComponent(orderId)}`, {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as OrderStatus;
  } catch {
    return null;
  }
}

const FAILED = new Set(["failed", "expired", "cancelled"]);
const NEEDS_ADMIN = new Set(["paid_unapplied", "paid_duplicate", "amount_mismatch", "challenge", "refunded"]);

export default function MidtransSnapModal(props: Props) {
  const { amount, onSuccess, onClose } = props;
  const [step, setStep] = useState<Step>("idle");
  const [errMsg, setErrMsg] = useState("");
  const [chargeAmount, setChargeAmount] = useState(amount);

  // Snap's callbacks outlive renders; read the latest values through refs
  // instead of stale closures.
  const stepRef = useRef<Step>("idle");
  const orderIdRef = useRef<string | null>(null);
  const aliveRef = useRef(true);
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;

  const go = useCallback((next: Step) => {
    stepRef.current = next;
    if (aliveRef.current) setStep(next);
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  /** Waits until the API reports the order as applied (or tells us why not). */
  const verify = useCallback(
    async (orderId: string, waitMs: number): Promise<"success" | "pending" | "review" | "failed"> => {
      const deadline = Date.now() + waitMs;
      for (;;) {
        const state = await fetchOrderStatus(orderId);
        if (state) {
          if (state.status === "paid" && state.manualPaymentStatus === "confirmed") return "success";
          if (NEEDS_ADMIN.has(state.status)) return "review";
          if (FAILED.has(state.status)) return "failed";
        }
        if (Date.now() >= deadline || !aliveRef.current) return "pending";
        await sleep(2_000);
      }
    },
    [],
  );

  const finishAfterPopup = useCallback(
    async (orderId: string, waitMs: number) => {
      go("verifying");
      const outcome = await verify(orderId, waitMs);
      if (!aliveRef.current) return;
      if (outcome === "success") {
        go("success");
        window.setTimeout(() => onSuccessRef.current(), 1_500);
      } else if (outcome === "review") {
        go("review");
      } else if (outcome === "failed") {
        setErrMsg("Pembayaran tidak berhasil. Silakan coba lagi atau pilih metode lain.");
        go("error");
      } else {
        go("pending");
      }
    },
    [go, verify],
  );

  async function handlePay() {
    go("loading");
    setErrMsg("");
    try {
      const [endpoint, body] =
        props.type === "subscription"
          ? (["/api/payments/midtrans/snap/subscription", { planId: props.planId }] as const)
          : props.type === "posting"
            ? (["/api/payments/midtrans/snap/posting", { jobId: props.jobId }] as const)
            : (["/api/payments/midtrans/create", { manualPaymentId: props.manualPaymentId }] as const);

      const res = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<SnapOrder> & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Gagal membuat sesi pembayaran.");
      if (!data.snapToken || !data.orderId || !data.clientKey || !data.snapJsUrl) {
        throw new Error("Respons pembayaran dari server tidak lengkap.");
      }
      const order = data as SnapOrder;
      orderIdRef.current = order.orderId;
      setChargeAmount(order.amount);

      await loadSnapScript(order.snapJsUrl, order.clientKey);
      if (!window.snap) throw new Error("Midtrans Snap belum siap. Muat ulang halaman.");
      if (!aliveRef.current) return;

      go("snap");
      window.snap.pay(order.snapToken, {
        onSuccess: () => void finishAfterPopup(order.orderId, 30_000),
        onPending: () => void finishAfterPopup(order.orderId, 2_000),
        onError: () => {
          setErrMsg("Pembayaran gagal. Coba metode lain.");
          go("error");
        },
        onClose: () => {
          // Closed without paying (a success/pending callback moves us on first).
          if (stepRef.current === "snap") go("idle");
        },
      });
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : "Gagal memulai pembayaran.");
      go("error");
    }
  }

  async function recheck() {
    if (orderIdRef.current) await finishAfterPopup(orderIdRef.current, 10_000);
  }

  const title =
    props.type === "subscription"
      ? `Rekhastha Bisnis ${props.planLabel ?? ""}`
      : props.type === "posting"
        ? `Posting: ${props.jobTitle ?? "Lowongan"}`
        : (props.title ?? "Tagihan Rekhastha");
  const busy = step === "loading" || step === "snap" || step === "verifying";
  const successText =
    props.type === "subscription"
      ? "Rekhastha Bisnis Anda sudah aktif."
      : props.type === "posting"
        ? "Lowongan Anda sudah tayang."
        : "Tagihan Anda sudah lunas.";

  return (
    <div className="fixed inset-0 z-[130] flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={busy ? undefined : onClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Bayar via Midtrans"
        className="relative z-10 bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-sm mx-0 sm:mx-4 shadow-2xl"
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100">
          <div>
            <h2 className="font-black text-gray-900 text-base">Bayar via Midtrans</h2>
            <p className="text-xs text-gray-400 mt-0.5 truncate max-w-[220px]">{title}</p>
          </div>
          {!busy && (
            <button onClick={onClose} aria-label="Tutup" className="text-gray-400 p-1">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        <div className="px-5 py-3 bg-blue-50 border-b border-blue-100">
          <div className="flex justify-between items-center">
            <span className="text-sm text-blue-700 font-semibold">Total</span>
            <span className="text-xl font-black text-blue-700">{fmt(chargeAmount)}</span>
          </div>
        </div>

        <div className="px-5 py-5 space-y-4">
          {step === "success" && (
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center text-2xl">✅</div>
              <p className="font-black text-gray-900">Pembayaran Berhasil!</p>
              <p className="text-xs text-gray-400 text-center">{successText}</p>
            </div>
          )}

          {step === "verifying" && (
            <div className="flex flex-col items-center gap-3 py-6">
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
              <p className="text-sm text-gray-500 text-center">Memastikan pembayaran Anda…</p>
            </div>
          )}

          {step === "pending" && (
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center text-2xl">⏳</div>
              <p className="font-black text-gray-900">Menunggu Pembayaran</p>
              <p className="text-xs text-gray-400 text-center">
                Selesaikan pembayaran sesuai instruksi di Midtrans. Layanan aktif otomatis begitu pembayaran dikonfirmasi.
                Jika sudah membayar, tekan Cek Status.
              </p>
              <button
                onClick={() => void recheck()}
                className="w-full bg-blue-600 text-white font-black py-3 rounded-2xl text-sm flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" /> Cek Status
              </button>
              <button onClick={onClose} className="text-sm text-blue-600 font-semibold">Tutup</button>
            </div>
          )}

          {step === "review" && (
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center text-2xl">🔎</div>
              <p className="font-black text-gray-900">Pembayaran Perlu Diperiksa</p>
              <p className="text-xs text-gray-500 text-center">
                Pembayaran Anda terdeteksi, tetapi belum bisa diaktifkan otomatis. Tim kami akan memeriksanya. Simpan bukti
                pembayaran dan hubungi admin bila belum aktif dalam 1×24 jam.
              </p>
              <button onClick={onClose} className="text-sm text-blue-600 font-semibold">Tutup</button>
            </div>
          )}

          {step === "error" && (
            <>
              <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-3 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <p className="text-xs text-red-600" role="alert">{errMsg}</p>
              </div>
              <button
                onClick={() => void handlePay()}
                className="w-full bg-blue-600 text-white font-black py-4 rounded-2xl text-sm flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" /> Coba Lagi
              </button>
            </>
          )}

          {step === "snap" && (
            <div className="flex flex-col items-center gap-3 py-6">
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
              <p className="text-sm text-gray-500">Selesaikan pembayaran di popup Midtrans…</p>
            </div>
          )}

          {(step === "idle" || step === "loading") && (
            <>
              <div className="bg-gray-50 rounded-xl px-4 py-3 space-y-2">
                <p className="text-xs font-bold text-gray-700">Metode pembayaran tersedia:</p>
                <div className="flex flex-wrap gap-1.5">
                  {["VA BCA", "VA BNI", "VA BRI", "VA Mandiri", "QRIS", "Kartu Kredit", "Indomaret", "Alfamart"].map((m) => (
                    <span key={m} className="text-[10px] bg-white border border-gray-200 rounded px-2 py-0.5 text-gray-500">{m}</span>
                  ))}
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-100 rounded-xl px-3 py-2.5 flex items-start gap-2">
                <CreditCard className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                <p className="text-xs text-blue-600 leading-relaxed">
                  Pembayaran diproses Midtrans. Layanan aktif otomatis setelah pembayaran dikonfirmasi.
                </p>
              </div>

              <button
                onClick={() => void handlePay()}
                disabled={step === "loading"}
                className={`w-full font-black py-4 rounded-2xl text-sm flex items-center justify-center gap-2 transition-all ${
                  step === "loading" ? "bg-blue-400 text-white cursor-not-allowed" : "bg-blue-600 text-white active:scale-95"
                }`}
              >
                {step === "loading" ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Menyiapkan…</>
                ) : (
                  <><CreditCard className="w-4 h-4" /> Bayar {fmt(chargeAmount)}</>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
