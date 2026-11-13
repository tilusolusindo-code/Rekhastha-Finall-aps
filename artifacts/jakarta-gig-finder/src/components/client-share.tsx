import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Link2, Loader2, Star, Trash2, X } from "lucide-react";

async function api<T = Record<string, unknown>>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", headers: { "Content-Type": "application/json" }, ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Terjadi kesalahan. Coba lagi.");
  return data as T;
}

export type ClientDecision = "setuju" | "tidak" | null | undefined;

/** Lencana penilaian klien (hanya saran — keputusan akhir tetap di agensi). */
export function ClientDecisionBadge({ decision, note }: { decision: ClientDecision; note?: string | null }) {
  if (!decision) return null;
  const ok = decision === "setuju";
  return (
    <div className={`rounded-lg px-2.5 py-1.5 text-[11px] ${ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
      <span className="font-black">Klien: {ok ? "Setuju" : "Tidak"}</span>
      {note ? <span className="font-normal"> — {note}</span> : null}
    </div>
  );
}

/** Tombol shortlist + bagikan ke klien untuk satu lamaran. */
export function ShortlistControls({
  applicationId, jobId, jobTitle, shortlisted, clientDecision, clientNote, status, onChanged,
}: {
  applicationId: number; jobId: number; jobTitle: string; shortlisted: boolean;
  clientDecision?: ClientDecision; clientNote?: string | null; status: string;
  onChanged?: (shortlisted: boolean) => void;
}) {
  const [on, setOn] = useState(shortlisted);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [share, setShare] = useState(false);
  useEffect(() => setOn(shortlisted), [shortlisted]);

  const editable = status === "baru" || status === "ditinjau" || status === "diterima";
  if (!editable && !on) return null;

  const toggle = async () => {
    setBusy(true); setError("");
    try {
      await api(`/api/applications/${applicationId}/shortlist`, { method: "POST", body: JSON.stringify({ shortlisted: !on }) });
      setOn(!on); onChanged?.(!on);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={toggle} disabled={busy || !editable}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-bold disabled:opacity-50 ${on ? "bg-amber-100 text-amber-800" : "border border-gray-200 bg-white text-gray-600"}`}>
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Star className={`h-3 w-3 ${on ? "fill-amber-500 text-amber-500" : ""}`} />}
          {on ? "Di shortlist" : "Masukkan shortlist"}
        </button>
        {on && (
          <button type="button" onClick={() => setShare(true)}
            className="flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-[11px] font-bold text-violet-700">
            <Link2 className="h-3 w-3" /> Bagikan ke klien
          </button>
        )}
      </div>
      {on && <ClientDecisionBadge decision={clientDecision} note={clientNote} />}
      {error && <p className="text-[11px] font-semibold text-red-600">{error}</p>}
      {share && <ClientShareDialog jobId={jobId} jobTitle={jobTitle} onClose={() => setShare(false)} />}
    </div>
  );
}

interface LinkRow { id: number; label: string; expiresAt: string; createdAt: string }

/** Dialog: buat/cabut tautan klien untuk satu lowongan. */
export function ClientShareDialog({ jobId, jobTitle, onClose }: { jobId: number; jobTitle: string; onClose: () => void }) {
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState("");
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try { setLinks((await api<{ links: LinkRow[] }>(`/api/client-links?jobId=${jobId}`)).links); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [jobId]);
  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    setBusy(true); setError(""); setCopied(false);
    try {
      const d = await api<{ url: string }>("/api/client-links", { method: "POST", body: JSON.stringify({ jobId, label: label.trim() || undefined, days }) });
      setCreated(d.url); setLabel(""); await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const revoke = async (id: number) => {
    setError("");
    try { await api(`/api/client-links/${id}`, { method: "DELETE" }); await load(); }
    catch (e) { setError((e as Error).message); }
  };
  const copy = async () => {
    if (!created) return;
    try { await navigator.clipboard.writeText(created); setCopied(true); } catch { setError("Gagal menyalin. Salin tautan secara manual."); }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="max-h-[90dvh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:max-w-md sm:rounded-3xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-black text-gray-900">Bagikan shortlist ke klien</h3>
            <p className="truncate text-[11px] text-gray-500">{jobTitle}</p>
          </div>
          <button onClick={onClose} aria-label="Tutup" className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-500"><X className="h-4 w-4" /></button>
        </div>

        <p className="rounded-xl bg-violet-50 p-3 text-[11px] leading-relaxed text-violet-900">
          Klien tidak perlu daftar. Ia hanya melihat <b>nama depan + inisial</b>, foto profil, keahlian, rating, dan jawaban teks pelamar yang sudah Anda masukkan ke shortlist.
          Kontak, rekening, NIK, CV, dan berkas unggahan <b>tidak</b> ditampilkan. Klien hanya bisa menilai Setuju/Tidak; keputusan akhir tetap Anda.
        </p>

        <div className="mt-4 space-y-2">
          <input value={label} onChange={(e) => setLabel(e.target.value.slice(0, 60))} placeholder="Nama klien (opsional), mis. PT Maju Jaya"
            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm" />
          <div className="flex gap-2">
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Masa berlaku" className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm">
              <option value={3}>Berlaku 3 hari</option><option value={7}>Berlaku 7 hari</option><option value={14}>Berlaku 14 hari</option>
            </select>
            <button onClick={create} disabled={busy}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-violet-700 py-2.5 text-sm font-black text-white disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Buat tautan
            </button>
          </div>
        </div>

        {created && (
          <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <p className="text-[11px] font-bold text-emerald-800">Tautan dibuat — salin sekarang, tidak akan ditampilkan lagi.</p>
            <p className="mt-1 break-all rounded-lg bg-white px-2 py-1.5 font-mono text-[11px] text-gray-700">{created}</p>
            <button onClick={copy} className="mt-2 flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-black text-white">
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} {copied ? "Tersalin" : "Salin tautan"}
            </button>
          </div>
        )}
        {error && <p className="mt-2 text-xs font-semibold text-red-600">{error}</p>}

        <div className="mt-4">
          <p className="mb-2 text-xs font-black text-gray-700">Tautan aktif</p>
          {loading ? <Loader2 className="mx-auto h-4 w-4 animate-spin text-gray-400" />
            : links.length === 0 ? <p className="text-[11px] text-gray-400">Belum ada tautan aktif.</p>
            : <ul className="space-y-1.5">{links.map((l) => (
                <li key={l.id} className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-bold text-gray-800">{l.label || "Tanpa nama"}</p>
                    <p className="text-[10px] text-gray-400">berlaku sampai {new Date(l.expiresAt).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}</p>
                  </div>
                  <button onClick={() => { if (confirm("Cabut tautan ini? Klien tidak bisa membukanya lagi.")) void revoke(l.id); }}
                    aria-label="Cabut tautan" className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-50 text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                </li>))}</ul>}
        </div>
      </div>
    </div>
  );
}
