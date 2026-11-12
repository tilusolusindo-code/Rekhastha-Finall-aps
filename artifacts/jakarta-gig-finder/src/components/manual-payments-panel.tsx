import { useCallback, useEffect, useState } from "react";
import { Banknote, CheckCircle2, Clock3, Copy, CreditCard, Loader2, MessageCircle, RefreshCw, X } from "lucide-react";
import { MANUAL_PAYMENT_WHATSAPP } from "@/lib/manual-payment-contact";

type ManualPayment = {
  id: number;
  targetType: string;
  targetId: string;
  amount: number;
  status: string;
  transferReference: string | null;
  proofNote: string | null;
  adminNote: string | null;
  createdAt: string;
  title?: string | null;
};

type PendingSubscription = {
  orderId: string;
  redirectUrl: string | null;
  amount: number;
  createdAt: string;
  label: string;
};

type TransferInstructions = {
  bankName: string;
  accountName: string;
  accountNumber: string;
  instructions: string;
} | null;

const TYPE_LABELS: Record<string, string> = {
  gig_escrow: "Pendanaan upah lowongan",
  instant_listing: "Biaya Instan Kilat",
  legacy_subscription: "Paket Bulanan",
  business_subscription: "Rekhastha Bisnis",
  project_escrow: "Pendanaan proyek",
};

const STATUS_LABELS: Record<string, string> = {
  awaiting_payment: "Menunggu transfer",
  under_review: "Sedang ditinjau admin",
  confirmed: "Pembayaran dikonfirmasi",
  rejected: "Perlu dikirim ulang",
};

function formatRp(amount: number) {
  return `Rp ${Math.round(amount).toLocaleString("id-ID")}`;
}

/** Jenis tagihan yang dibayar lewat Midtrans (QRIS, Virtual Account, e-wallet, minimarket). */
const isMidtransBill = (p: ManualPayment) => p.targetType === "gig_escrow";

export default function ManualPaymentsPanel({
  onClose,
  onGigCancelled,
}: {
  onClose: () => void;
  /** Dipanggil setelah lowongan belum bayar dibatalkan dari panel ini. */
  onGigCancelled?: (gigId: number) => void;
}) {
  const [payments, setPayments] = useState<ManualPayment[]>([]);
  const [subscriptions, setSubscriptions] = useState<PendingSubscription[]>([]);
  const [payingKey, setPayingKey] = useState<string | null>(null);
  const [instructions, setInstructions] = useState<TransferInstructions>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/manual-payments/mine", {
        credentials: "include",
        cache: "no-store",
      });
      const data = (await response.json()) as {
        error?: string;
        payments?: ManualPayment[];
        instructions?: TransferInstructions;
      };
      if (!response.ok) throw new Error(data.error || "Tagihan tidak dapat dimuat.");
      setPayments((data.payments ?? []).filter((p) => p.status !== "cancelled"));
      setInstructions(data.instructions ?? null);
      try {
        const subRes = await fetch("/api/payments/midtrans/mine", { credentials: "include", cache: "no-store" });
        const subData = (await subRes.json()) as { subscriptions?: PendingSubscription[] };
        setSubscriptions(subRes.ok ? subData.subscriptions ?? [] : []);
      } catch {
        setSubscriptions([]);
      }
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat tagihan.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const confirmViaWhatsapp = async (payment: ManualPayment) => {
    const message = [
      "Halo admin Rekhastha, saya sudah melakukan pembayaran.",
      `ID pembayaran: ${payment.id}`,
      `Jenis: ${TYPE_LABELS[payment.targetType] ?? payment.targetType}`,
      `ID tagihan: ${payment.targetId}`,
      `Jumlah: ${formatRp(payment.amount)}`,
      "Mohon verifikasi pembayaran saya. Saya akan melampirkan screenshot bukti transfer di chat ini.",
    ].join("\n");
    const whatsappUrl = `https://wa.me/${MANUAL_PAYMENT_WHATSAPP.phone}?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, "_blank", "noopener,noreferrer");
    setBusyId(payment.id);
    setError("");
    try {
      const response = await fetch(`/api/manual-payments/${payment.id}/submit`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transferReference: `WA-${payment.id}`,
          proofNote: "Pengguna diarahkan ke WhatsApp untuk mengirim bukti; lampiran dikirim langsung melalui chat.",
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Konfirmasi pembayaran gagal dikirim.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Konfirmasi pembayaran gagal dikirim.");
    } finally {
      setBusyId(null);
    }
  };

  // Bayar (atau bayar ulang dengan metode lain): server mematikan transaksi lama lalu membuat yang baru.
  const payWithMidtrans = async (payment: ManualPayment) => {
    setPayingKey(`gig-${payment.id}`);
    setError("");
    try {
      const response = await fetch("/api/payments/midtrans/snap/posting", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: Number(payment.targetId) }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; redirectUrl?: string; orderId?: string };
      if (!response.ok) throw new Error(data.error || "Gagal membuat sesi pembayaran.");
      if (!data.redirectUrl) throw new Error("Halaman pembayaran tidak tersedia. Hubungi admin.");
      try { sessionStorage.setItem("rekhastha_last_midtrans_order", data.orderId ?? ""); } catch { /* mode privat */ }
      window.location.href = data.redirectUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal membuat sesi pembayaran.");
      setPayingKey(null);
    }
  };

  const cancelGig = async (payment: ManualPayment) => {
    const name = payment.title ? `"${payment.title}"` : `#${payment.targetId}`;
    if (!window.confirm(`Batalkan lowongan ${name}? Lowongan yang belum dibayar akan dihapus dari daftar.`)) return;
    setPayingKey(`cancel-${payment.id}`);
    setError("");
    try {
      const response = await fetch(`/api/gigs/${payment.targetId}/cancel-unpaid`, { method: "POST", credentials: "include" });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Gagal membatalkan lowongan.");
      onGigCancelled?.(Number(payment.targetId));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal membatalkan lowongan.");
    } finally {
      setPayingKey(null);
    }
  };

  const cancelSubscription = async (sub: PendingSubscription) => {
    if (!window.confirm(`Batalkan pembayaran Rekhastha Bisnis ${sub.label}?`)) return;
    setPayingKey(`sub-${sub.orderId}`);
    setError("");
    try {
      const response = await fetch(`/api/payments/midtrans/subscription/${encodeURIComponent(sub.orderId)}/cancel`, {
        method: "POST",
        credentials: "include",
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Gagal membatalkan pembayaran.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal membatalkan pembayaran.");
    } finally {
      setPayingKey(null);
    }
  };

  const midtransBills = payments.filter((p) => isMidtransBill(p) && (p.status === "awaiting_payment" || p.status === "rejected"));
  const otherPayments = payments.filter((p) => !isMidtransBill(p) || (p.status !== "awaiting_payment" && p.status !== "rejected"));
  const needsManualInstructions = otherPayments.some((p) => !isMidtransBill(p) && (p.status === "awaiting_payment" || p.status === "rejected"));

  const copyAccount = async () => {
    if (!instructions?.accountNumber) return;
    try {
      await navigator.clipboard.writeText(instructions.accountNumber);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Nomor rekening tidak dapat disalin di browser ini.");
    }
  };

  return (
    <div className="fixed inset-0 z-[120] bg-slate-950/55 p-3 sm:p-6 flex items-center justify-center">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-payments-title"
        className="w-full max-w-2xl max-h-[92vh] overflow-hidden rounded-3xl bg-white shadow-2xl flex flex-col"
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
              <Banknote className="w-5 h-5" />
            </div>
            <div>
              <h2 id="manual-payments-title" className="font-black text-slate-900">Pembayaran</h2>
              <p className="text-xs text-slate-500">Bayar lewat Midtrans: QRIS, Virtual Account, e-wallet, atau minimarket. Layanan aktif otomatis setelah lunas.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void load()}
              aria-label="Muat ulang"
              className="p-2 rounded-xl text-slate-500 hover:bg-slate-100"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Tutup pembayaran"
              className="p-2 rounded-xl text-slate-500 hover:bg-slate-100"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </header>

        <div className="overflow-y-auto p-4 sm:p-5 space-y-4">
          {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          {loading ? (
            <div className="py-12 flex justify-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : (
            <>
              {midtransBills.length === 0 && subscriptions.length === 0 && otherPayments.length === 0 && (
                <div className="py-12 text-center">
                  <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-300" />
                  <p className="mt-2 text-sm font-bold text-slate-700">Belum ada tagihan</p>
                  <p className="mt-1 text-xs text-slate-500">Tagihan lowongan dan layanan akan muncul di sini.</p>
                </div>
              )}

              {(midtransBills.length > 0 || subscriptions.length > 0) && (
                <section className="space-y-3">
                  <h3 className="text-[11px] font-black uppercase tracking-wide text-slate-500">Menunggu pembayaran</h3>
                  {midtransBills.map((payment) => (
                    <article key={`gig-${payment.id}`} className="rounded-2xl border border-amber-200 bg-amber-50/40 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-900 truncate">
                            {payment.title ?? `Lowongan #${payment.targetId}`}
                          </p>
                          <p className="text-[11px] text-slate-500">Pendanaan upah + biaya layanan</p>
                          <p className="mt-1 text-lg font-black text-slate-900">{formatRp(payment.amount)}</p>
                        </div>
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold text-amber-800">
                          <Clock3 className="w-3 h-3" /> Belum dibayar
                        </span>
                      </div>
                      {payment.adminNote && (
                        <p className="mt-3 rounded-xl bg-red-50 p-2.5 text-xs text-red-700">{payment.adminNote}</p>
                      )}
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          disabled={payingKey !== null}
                          onClick={() => void cancelGig(payment)}
                          className="rounded-xl border border-red-200 bg-white px-3 py-2.5 text-xs font-bold text-red-600 disabled:opacity-50"
                        >
                          {payingKey === `cancel-${payment.id}` ? "…" : "Batalkan"}
                        </button>
                        <button
                          type="button"
                          disabled={payingKey !== null}
                          onClick={() => void payWithMidtrans(payment)}
                          className="flex-1 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <span className="inline-flex items-center justify-center gap-2">
                            {payingKey === `gig-${payment.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                            Bayar via Midtrans
                          </span>
                        </button>
                      </div>
                    </article>
                  ))}
                  {subscriptions.map((sub) => (
                    <article key={sub.orderId} className="rounded-2xl border border-amber-200 bg-amber-50/40 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold text-slate-900">Rekhastha Bisnis {sub.label}</p>
                          <p className="mt-1 text-lg font-black text-slate-900">{formatRp(sub.amount)}</p>
                        </div>
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold text-amber-800">
                          <Clock3 className="w-3 h-3" /> Belum dibayar
                        </span>
                      </div>
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          disabled={payingKey !== null}
                          onClick={() => void cancelSubscription(sub)}
                          className="rounded-xl border border-red-200 bg-white px-3 py-2.5 text-xs font-bold text-red-600 disabled:opacity-50"
                        >
                          {payingKey === `sub-${sub.orderId}` ? "…" : "Batalkan"}
                        </button>
                        {sub.redirectUrl && (
                          <a
                            href={sub.redirectUrl}
                            className="flex-1 rounded-xl bg-emerald-700 px-4 py-2.5 text-center text-sm font-bold text-white"
                          >
                            <span className="inline-flex items-center justify-center gap-2">
                              <CreditCard className="h-4 w-4" /> Lanjutkan bayar
                            </span>
                          </a>
                        )}
                      </div>
                      <p className="mt-2 text-[10px] text-slate-500">
                        Ingin metode lain? Batalkan, lalu pilih paket lagi di tab Rekhastha Bisnis.
                      </p>
                    </article>
                  ))}
                  <p className="text-[10px] text-slate-500">Tagihan lowongan yang tidak dibayar dalam 24 jam ditutup otomatis.</p>
                </section>
              )}

              {otherPayments.length > 0 && (
                <section className="space-y-3">
                  <h3 className="text-[11px] font-black uppercase tracking-wide text-slate-500">Riwayat dan tagihan lain</h3>
                  {needsManualInstructions && (instructions ? (
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
                      <p className="text-[11px] font-black uppercase tracking-wide text-emerald-800">Tagihan ini dibayar lewat transfer bank</p>
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold text-slate-900">{instructions.bankName}</p>
                          <p className="text-xs text-slate-600">a.n. {instructions.accountName}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void copyAccount()}
                          className="shrink-0 flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-bold text-emerald-800"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          {copied ? "Tersalin" : "Salin rekening"}
                        </button>
                      </div>
                      <p className="mt-2 font-mono text-lg font-black tracking-wide text-slate-900">{instructions.accountNumber}</p>
                      {instructions.instructions && (
                        <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-slate-600">{instructions.instructions}</p>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                      Admin belum mengatur rekening dan instruksi transfer.
                    </div>
                  ))}
                  {otherPayments.map((payment) => {
                    const canSubmit = !isMidtransBill(payment) && (payment.status === "awaiting_payment" || payment.status === "rejected");
                    return (
                      <article key={payment.id} className="rounded-2xl border border-slate-200 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-bold text-slate-900">
                              {payment.title ?? TYPE_LABELS[payment.targetType] ?? "Pembayaran Rekhastha"}
                            </p>
                            <p className="mt-1 text-lg font-black text-slate-900">{formatRp(payment.amount)}</p>
                          </div>
                          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold ${
                            payment.status === "confirmed"
                              ? "bg-emerald-100 text-emerald-800"
                              : payment.status === "rejected"
                                ? "bg-red-100 text-red-700"
                                : payment.status === "under_review"
                                  ? "bg-blue-100 text-blue-700"
                                  : "bg-amber-100 text-amber-800"
                          }`}>
                            {payment.status === "confirmed" ? <CheckCircle2 className="w-3 h-3" /> : <Clock3 className="w-3 h-3" />}
                            {payment.status === "confirmed" ? "Lunas" : STATUS_LABELS[payment.status] ?? payment.status}
                          </span>
                        </div>
                        {payment.adminNote && (
                          <p className="mt-3 rounded-xl bg-red-50 p-2.5 text-xs text-red-700">{payment.adminNote}</p>
                        )}
                        {payment.status === "under_review" && payment.transferReference && (
                          <p className="mt-3 text-xs text-slate-600">Referensi transfer: <b>{payment.transferReference}</b></p>
                        )}
                        {canSubmit && (
                          <div className="mt-4 space-y-2">
                            <button
                              type="button"
                              disabled={busyId === payment.id}
                              onClick={() => void confirmViaWhatsapp(payment)}
                              className="w-full rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {busyId === payment.id ? "Membuka WhatsApp…" : (
                                <span className="inline-flex items-center justify-center gap-2">
                                  <MessageCircle className="h-4 w-4" />
                                  Kirim bukti via WhatsApp
                                </span>
                              )}
                            </button>
                            <p className="text-center text-[11px] leading-relaxed text-slate-500">
                              Chat akan dibuka ke {MANUAL_PAYMENT_WHATSAPP.display}. Lampirkan foto atau screenshot bukti transfer sebelum mengirim pesan.
                            </p>
                          </div>
                        )}
                        <p className="mt-3 text-[10px] text-slate-400">
                          Dibuat {new Date(payment.createdAt).toLocaleString("id-ID")}
                        </p>
                      </article>
                    );
                  })}
                </section>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}