import { useCallback, useEffect, useState } from "react";
import { Briefcase, Check, Loader2, Star, ThumbsDown, ThumbsUp, User } from "lucide-react";

interface Candidate {
  id: number;
  displayName: string;
  avatarUrl: string | null;
  skills: string[];
  stats: { ratingAvg: number | null; ratingCount: number; completedJobs: number };
  experience: string;
  education: string;
  answers: { prompt: string; answer: string }[];
  decision: "setuju" | "tidak" | null;
  note: string;
}
interface ClientView { jobTitle: string; companyName: string; label: string; expiresAt: string; candidates: Candidate[] }

export function getClientToken(): string | null {
  try {
    const t = new URLSearchParams(window.location.search).get("klien");
    return t && /^[A-Za-z0-9_-]{20,80}$/.test(t) ? t : null;
  } catch { return null; }
}

function CandidateCard({ c, token, onSaved }: { c: Candidate; token: string; onSaved: () => void }) {
  const [note, setNote] = useState(c.note);
  const [busy, setBusy] = useState<"setuju" | "tidak" | "reset" | null>(null);
  const [error, setError] = useState("");
  useEffect(() => setNote(c.note), [c.note]);

  const send = async (decision: "setuju" | "tidak" | null) => {
    setBusy(decision ?? "reset"); setError("");
    try {
      const res = await fetch(`/api/public/client-view/${encodeURIComponent(token)}/decision`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId: c.id, decision, note: note.trim() || undefined }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((d as { error?: string }).error ?? "Gagal menyimpan penilaian.");
      onSaved();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  };

  return (
    <article className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        {c.avatarUrl
          ? <img src={c.avatarUrl} alt="" referrerPolicy="no-referrer" className="h-14 w-14 rounded-2xl object-cover bg-gray-100" />
          : <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700"><User className="h-6 w-6" /></div>}
        <div className="min-w-0">
          <h2 className="truncate text-base font-black text-gray-900">{c.displayName}</h2>
          <p className="flex items-center gap-1 text-xs text-gray-500">
            {c.stats.ratingAvg != null && <><Star className="h-3 w-3 fill-amber-400 text-amber-400" />{c.stats.ratingAvg.toFixed(1)} ({c.stats.ratingCount}) · </>}
            {c.stats.completedJobs} pekerjaan selesai
          </p>
        </div>
        {c.decision && (
          <span className={`ml-auto shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black ${c.decision === "setuju" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"}`}>
            {c.decision === "setuju" ? "Setuju" : "Tidak"}
          </span>
        )}
      </div>

      {c.skills.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {c.skills.slice(0, 8).map((s) => <span key={s} className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-semibold text-gray-600">{s}</span>)}
        </div>
      )}
      {(c.experience || c.education) && (
        <dl className="mt-3 space-y-1.5 text-xs text-gray-700">
          {c.experience && <div><dt className="font-bold text-gray-500">Pengalaman</dt><dd className="whitespace-pre-wrap break-words">{c.experience}</dd></div>}
          {c.education && <div><dt className="font-bold text-gray-500">Pendidikan</dt><dd className="whitespace-pre-wrap break-words">{c.education}</dd></div>}
        </dl>
      )}
      {c.answers.length > 0 && (
        <div className="mt-3 space-y-2 rounded-xl bg-blue-50/60 p-3">
          {c.answers.map((a) => (
            <div key={a.prompt}>
              <p className="text-[11px] font-bold text-blue-900">{a.prompt}</p>
              <p className="whitespace-pre-wrap break-words text-xs text-gray-700">{a.answer}</p>
            </div>
          ))}
        </div>
      )}

      <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 300))} rows={2} placeholder="Catatan untuk agensi (opsional)"
        className="mt-3 w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm" />
      <div className="mt-2 flex gap-2">
        <button onClick={() => send("setuju")} disabled={busy !== null}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-black disabled:opacity-60 ${c.decision === "setuju" ? "bg-emerald-600 text-white" : "border border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
          {busy === "setuju" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ThumbsUp className="h-4 w-4" />} Setuju
        </button>
        <button onClick={() => send("tidak")} disabled={busy !== null}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-black disabled:opacity-60 ${c.decision === "tidak" ? "bg-red-600 text-white" : "border border-red-200 bg-red-50 text-red-600"}`}>
          {busy === "tidak" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ThumbsDown className="h-4 w-4" />} Tidak
        </button>
      </div>
      {c.decision && (
        <button onClick={() => send(null)} disabled={busy !== null} className="mt-2 text-[11px] font-semibold text-gray-400 underline">Batalkan penilaian</button>
      )}
      {error && <p className="mt-2 text-xs font-semibold text-red-600">{error}</p>}
    </article>
  );
}

/** Halaman klien agensi: menilai shortlist lewat tautan khusus, tanpa login. */
export default function KlienPage({ token }: { token: string }) {
  const [view, setView] = useState<ClientView | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "invalid" | "error">("loading");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/public/client-view/${encodeURIComponent(token)}`, { cache: "no-store" });
      if (res.status === 404) { setState("invalid"); return; }
      if (!res.ok) { setState("error"); return; }
      setView(await res.json()); setState("ok");
    } catch { setState("error"); }
  }, [token]);
  useEffect(() => {
    document.title = "Shortlist kandidat";
    void load();
  }, [load]);

  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="border-b border-gray-200 bg-white px-4 py-4">
        <div className="mx-auto flex max-w-xl items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white"><Briefcase className="h-5 w-5" /></div>
          <div className="min-w-0">
            <p className="truncate text-sm font-black text-gray-900">{view?.jobTitle ?? "Shortlist kandidat"}</p>
            <p className="truncate text-[11px] text-gray-500">{view ? `Disiapkan oleh ${view.companyName}` : "Rekhastha"}</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-xl space-y-3 px-4 py-5">
        {state === "loading" && <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>}
        {state === "invalid" && (
          <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center">
            <p className="text-base font-black text-gray-900">Tautan tidak berlaku</p>
            <p className="mt-1 text-sm text-gray-500">Tautan ini sudah kedaluwarsa atau dicabut. Minta tautan baru kepada agensi yang mengirimkannya.</p>
          </div>
        )}
        {state === "error" && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700">
            Gagal memuat data. <button onClick={() => { setState("loading"); void load(); }} className="font-bold underline">Coba lagi</button>
          </div>
        )}
        {state === "ok" && view && (
          <>
            <div className="rounded-2xl bg-emerald-50 p-4 text-xs leading-relaxed text-emerald-900">
              <p className="flex items-center gap-1.5 font-black"><Check className="h-3.5 w-3.5" /> Pilih kandidat yang cocok</p>
              <p className="mt-1">Tekan <b>Setuju</b> atau <b>Tidak</b> pada tiap kandidat. Penilaian Anda diteruskan ke agensi sebagai masukan; keputusan akhir ada pada agensi.
                Demi privasi, kontak dan data pribadi kandidat tidak ditampilkan. Tautan berlaku sampai {new Date(view.expiresAt).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}.</p>
            </div>
            {view.candidates.length === 0
              ? <p className="py-10 text-center text-sm text-gray-400">Belum ada kandidat di shortlist.</p>
              : view.candidates.map((c) => <CandidateCard key={c.id} c={c} token={token} onSaved={load} />)}
          </>
        )}
      </main>
    </div>
  );
}
