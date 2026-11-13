import type { ReactElement } from "react";
import { useCallback, useEffect, useState } from "react";
import { Users, Eye, Building2, Loader2, Check, X, LogOut, ExternalLink } from "lucide-react";
import { ShortlistControls } from "./client-share";

export type TeamRole = "hr" | "supervisor";

export interface Membership {
  companyId: string;
  companyName: string;
  role: TeamRole;
  acceptedAt: string;
  permissions: string[];
}

interface TeamInvitation {
  id: number;
  role: TeamRole;
  company_name: string;
  expires_at: string;
}

const ROLE_INFO: Record<TeamRole, { label: string; icon: ReactElement; color: string; bg: string; desc: string }> = {
  hr:         { label: "HR / Rekrutmen",      icon: <Users className="w-4 h-4" />, color: "text-violet-700", bg: "bg-violet-100", desc: "Tinjau, terima, dan tolak pelamar" },
  supervisor: { label: "Supervisor Lapangan", icon: <Eye className="w-4 h-4" />,   color: "text-blue-700",   bg: "bg-blue-100",   desc: "Pantau pekerja dan presensi harian" },
};

async function api<T = Record<string, unknown>>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", headers: { "Content-Type": "application/json" }, ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Terjadi kesalahan. Coba lagi.");
  return data as T;
}

export async function fetchMemberships(): Promise<Membership[]> {
  try {
    const d = await api<{ memberships?: Membership[] }>("/api/team/my-membership");
    return d.memberships ?? [];
  } catch { return []; }
}

/** Banner di profil pekerja: undangan tim yang menunggu + tim tempat saya bergabung. */
export function TeamMembershipBanner() {
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [invitations, setInvitations] = useState<TeamInvitation[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [m, inv] = await Promise.all([
      fetchMemberships(),
      api<{ invitations?: TeamInvitation[] }>("/api/team/invitations/mine").then(d => d.invitations ?? []).catch(() => []),
    ]);
    setMemberships(m); setInvitations(inv);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key); setError("");
    try { await fn(); await load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  };

  if (memberships.length === 0 && invitations.length === 0) return null;

  return (
    <div className="mx-4 mt-4 space-y-3">
      {invitations.map(inv => {
        const r = ROLE_INFO[inv.role] ?? ROLE_INFO.hr;
        return (
          <div key={inv.id} className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-xs font-black text-amber-700 uppercase tracking-wide">Undangan Tim</p>
            <p className="text-sm font-bold text-gray-900 mt-0.5">{inv.company_name} mengundang Anda sebagai {r.label}</p>
            <p className="text-[11px] text-gray-500 mt-0.5">{r.desc}. Anda tidak akan melihat data keuangan perusahaan.</p>
            <div className="flex gap-2 mt-3">
              <button disabled={busy !== null} onClick={() => act(`a${inv.id}`, () => api(`/api/team/invitations/${inv.id}/accept`, { method: "POST" }))}
                className="flex-1 bg-violet-700 text-white text-xs font-black py-2 rounded-xl flex items-center justify-center gap-1.5 disabled:opacity-50">
                {busy === `a${inv.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Terima
              </button>
              <button disabled={busy !== null} onClick={() => act(`d${inv.id}`, () => api(`/api/team/invitations/${inv.id}/decline`, { method: "POST" }))}
                className="flex-1 bg-white border border-gray-200 text-gray-600 text-xs font-bold py-2 rounded-xl flex items-center justify-center gap-1.5 disabled:opacity-50">
                <X className="w-3.5 h-3.5" /> Tolak
              </button>
            </div>
          </div>
        );
      })}

      {memberships.map(m => {
        const r = ROLE_INFO[m.role] ?? ROLE_INFO.hr;
        const since = new Date(m.acceptedAt).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
        return (
          <div key={m.companyId} className={`rounded-2xl border ${r.bg} p-4 flex items-start gap-3`}>
            <div className={`w-10 h-10 rounded-xl bg-white/60 flex items-center justify-center shrink-0 ${r.color}`}>
              <Building2 className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-xs font-black ${r.color} uppercase tracking-wide`}>Anggota Tim</p>
              <p className="text-sm font-bold text-gray-900 mt-0.5 truncate">{m.companyName}</p>
              <span className={`inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/70 ${r.color}`}>{r.icon} {r.label}</span>
              <p className="text-[10px] text-gray-500 mt-1">Aktif sejak {since} · buka menu <b>Bisnis</b> untuk bekerja</p>
              <button disabled={busy !== null}
                onClick={() => { if (confirm(`Keluar dari tim ${m.companyName}?`)) void act(`l${m.companyId}`, () => api(`/api/team/membership/${m.companyId}`, { method: "DELETE" })); }}
                className="mt-2 text-[11px] font-bold text-gray-500 hover:text-red-600 flex items-center gap-1 disabled:opacity-50">
                <LogOut className="w-3 h-3" /> Keluar dari tim
              </button>
            </div>
          </div>
        );
      })}
      {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
    </div>
  );
}

/* ───────────────────────── Ruang kerja anggota tim ───────────────────────── */

interface WorkerApplication {
  id: number; jobId: number; jobTitle: string; workerName: string; status: string; createdAt: string;
  cvLink?: string | null; portfolioLink?: string | null; supportingInfo?: string | null;
  shortlistedAt?: string | null; clientDecision?: "setuju" | "tidak" | null; clientNote?: string | null;
  workerSkills: string[];
  workerStats: { ratingAvg: number | null; ratingCount: number; completedJobs: number };
}
interface GigRow {
  id: number; posisi: string; jobDate?: string | null; jamKerja?: string | null; alamat?: string | null; kuota?: number | null;
  workers: { applicationId: number; workerName: string; status: string }[];
}
interface AttRow { id: number; jobTitle: string; workerName: string; kind: string; at: string }

const STATUS_LABEL: Record<string, string> = {
  baru: "Baru", ditinjau: "Ditinjau", diterima: "Diterima", ditolak: "Ditolak", selesai: "Selesai",
};

function todayWIB() {
  return new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
}

function ApplicationsPanel({ companyId, canDecide }: { companyId: string; canDecide: boolean }) {
  const [rows, setRows] = useState<WorkerApplication[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api<WorkerApplication[]>(`/api/team/company/${companyId}/applications`).then(setRows).catch(e => { setError((e as Error).message); setRows([]); });
  }, [companyId]);
  useEffect(() => { load(); }, [load]);

  const decide = async (id: number, status: "ditinjau" | "diterima" | "ditolak") => {
    setBusy(id); setError("");
    try { await api(`/api/applications/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }); load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  };

  if (!rows) return <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>;
  return (
    <div className="space-y-2">
      {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
      {rows.length === 0 && <p className="py-8 text-center text-sm text-gray-400">Belum ada lamaran.</p>}
      {rows.map(a => (
        <div key={a.id} className="bg-white rounded-2xl border border-gray-100 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-bold text-gray-900 truncate">{a.workerName}</p>
              <p className="text-[11px] text-gray-500 truncate">Melamar: {a.jobTitle}</p>
            </div>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 shrink-0">{STATUS_LABEL[a.status] ?? a.status}</span>
          </div>
          <p className="text-[11px] text-gray-400 mt-1">
            {a.workerStats.completedJobs} pekerjaan selesai{a.workerStats.ratingAvg != null ? ` · ★ ${a.workerStats.ratingAvg.toFixed(1)} (${a.workerStats.ratingCount})` : ""}
          </p>
          {a.workerSkills.length > 0 && <p className="text-[11px] text-gray-500 mt-1 truncate">{a.workerSkills.slice(0, 5).join(" · ")}</p>}
          {a.supportingInfo && <p className="text-xs text-gray-600 mt-2 line-clamp-3">{a.supportingInfo}</p>}
          <div className="flex gap-3 mt-2">
            {a.cvLink && <a href={a.cvLink} target="_blank" rel="noopener noreferrer" className="text-[11px] font-bold text-violet-700 flex items-center gap-1">CV <ExternalLink className="w-3 h-3" /></a>}
            {a.portfolioLink && <a href={a.portfolioLink} target="_blank" rel="noopener noreferrer" className="text-[11px] font-bold text-violet-700 flex items-center gap-1">Portofolio <ExternalLink className="w-3 h-3" /></a>}
          </div>
          {canDecide && (
            <div className="mt-3">
              <ShortlistControls applicationId={a.id} jobId={a.jobId} jobTitle={a.jobTitle} status={a.status}
                shortlisted={!!a.shortlistedAt} clientDecision={a.clientDecision} clientNote={a.clientNote} />
            </div>
          )}
          {canDecide && (a.status === "baru" || a.status === "ditinjau") && (
            <div className="flex gap-2 mt-3">
              {a.status === "baru" && (
                <button disabled={busy === a.id} onClick={() => decide(a.id, "ditinjau")} className="flex-1 py-2 rounded-xl border border-gray-200 text-xs font-bold text-gray-600 disabled:opacity-50">Tinjau</button>
              )}
              <button disabled={busy === a.id} onClick={() => decide(a.id, "diterima")} className="flex-1 py-2 rounded-xl bg-emerald-600 text-white text-xs font-black disabled:opacity-50">Terima</button>
              <button disabled={busy === a.id} onClick={() => { if (confirm(`Tolak ${a.workerName}?`)) void decide(a.id, "ditolak"); }} className="flex-1 py-2 rounded-xl bg-red-50 text-red-600 text-xs font-black disabled:opacity-50">Tolak</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function GigsPanel({ companyId }: { companyId: string }) {
  const [gigs, setGigs] = useState<GigRow[] | null>(null);
  useEffect(() => {
    api<{ gigs: GigRow[] }>(`/api/team/company/${companyId}/gigs`).then(d => setGigs(d.gigs)).catch(() => setGigs([]));
  }, [companyId]);
  if (!gigs) return <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>;
  if (gigs.length === 0) return <p className="py-8 text-center text-sm text-gray-400">Belum ada lowongan aktif.</p>;
  return (
    <div className="space-y-2">
      {gigs.map(g => (
        <div key={g.id} className="bg-white rounded-2xl border border-gray-100 p-4">
          <p className="text-sm font-bold text-gray-900">{g.posisi}</p>
          <p className="text-[11px] text-gray-500 mt-0.5">{[g.jobDate, g.jamKerja, g.alamat].filter(Boolean).join(" · ")}</p>
          <p className="text-[11px] font-bold text-gray-400 mt-2 uppercase tracking-wide">Pekerja ({g.workers.length}{g.kuota ? `/${g.kuota}` : ""})</p>
          {g.workers.length === 0
            ? <p className="text-xs text-gray-400 mt-1">Belum ada pekerja diterima.</p>
            : <ul className="mt-1 space-y-0.5">{g.workers.map(w => <li key={w.applicationId} className="text-xs text-gray-700">• {w.workerName}</li>)}</ul>}
        </div>
      ))}
    </div>
  );
}

function AttendancePanel({ companyId }: { companyId: string }) {
  const [date, setDate] = useState(todayWIB());
  const [rows, setRows] = useState<AttRow[] | null>(null);
  useEffect(() => {
    setRows(null);
    api<{ records: AttRow[] }>(`/api/team/company/${companyId}/attendance?date=${date}`).then(d => setRows(d.records)).catch(() => setRows([]));
  }, [companyId, date]);
  return (
    <div>
      <input type="date" value={date} max={todayWIB()} onChange={e => e.target.value && setDate(e.target.value)}
        className="mb-3 px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white" />
      {!rows ? <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
        : rows.length === 0 ? <p className="py-8 text-center text-sm text-gray-400">Belum ada presensi pada tanggal ini.</p>
        : <div className="space-y-2">{rows.map(r => (
            <div key={r.id} className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-bold text-gray-900 truncate">{r.workerName}</p>
                <p className="text-[11px] text-gray-500 truncate">{r.jobTitle}</p>
              </div>
              <div className="text-right shrink-0">
                <p className={`text-[11px] font-black ${r.kind === "masuk" ? "text-emerald-600" : "text-blue-600"}`}>{r.kind === "masuk" ? "Masuk" : "Pulang"}</p>
                <p className="text-[10px] text-gray-400">{new Date(r.at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" })}</p>
              </div>
            </div>))}</div>}
    </div>
  );
}

/** Ruang kerja anggota tim — isi menyesuaikan hak peran. */
export function TeamMemberBisnisView({ memberships }: { memberships: Membership[] }) {
  const [activeId, setActiveId] = useState(memberships[0]?.companyId ?? "");
  const m = memberships.find(x => x.companyId === activeId) ?? memberships[0];
  const [tab, setTab] = useState<"applications" | "gigs" | "attendance">("gigs");
  if (!m) return null;
  const r = ROLE_INFO[m.role] ?? ROLE_INFO.hr;
  const can = (p: string) => m.permissions.includes(p);
  const tabs = [
    can("applications.view") && { key: "applications" as const, label: "Lamaran" },
    can("gigs.view") && { key: "gigs" as const, label: "Lowongan" },
    can("attendance.view") && { key: "attendance" as const, label: "Presensi" },
  ].filter(Boolean) as { key: "applications" | "gigs" | "attendance"; label: string }[];
  const current = tabs.some(t => t.key === tab) ? tab : tabs[0]?.key;

  return (
    <div className="flex-1 overflow-y-auto" style={{ background: "#F8FAFC" }}>
      <div className="px-5 pt-7 pb-5" style={{ background: "linear-gradient(145deg, #0f3460 0%, #16213e 60%, #1a1a2e 100%)" }}>
        <div className="flex items-center gap-3">
          <div className={`w-12 h-12 rounded-2xl ${r.bg} flex items-center justify-center ${r.color}`}>{r.icon}</div>
          <div className="min-w-0">
            <h1 className="text-white font-black text-xl tracking-tight truncate">Tim {m.companyName}</h1>
            <p className="text-white/60 text-xs">Anda bergabung sebagai {r.label}</p>
          </div>
        </div>
        {memberships.length > 1 && (
          <select value={m.companyId} onChange={e => setActiveId(e.target.value)} className="mt-3 w-full px-3 py-2 rounded-xl text-sm bg-white/10 text-white border border-white/20">
            {memberships.map(x => <option key={x.companyId} value={x.companyId} className="text-black">{x.companyName}</option>)}
          </select>
        )}
      </div>

      <div className="px-4 pt-4 pb-8">
        <div className="flex gap-2 mb-4">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-2 rounded-full text-xs font-bold ${current === t.key ? "bg-violet-700 text-white" : "bg-white border border-gray-200 text-gray-600"}`}>{t.label}</button>
          ))}
        </div>
        {current === "applications" && <ApplicationsPanel key={m.companyId} companyId={m.companyId} canDecide={can("applications.decide")} />}
        {current === "gigs" && <GigsPanel key={m.companyId} companyId={m.companyId} />}
        {current === "attendance" && <AttendancePanel key={m.companyId} companyId={m.companyId} />}

        <div className="mt-5 rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
          <p className="text-xs text-gray-500 leading-relaxed">
            Data keuangan, rekening, dan identitas pelamar tidak ditampilkan untuk anggota tim. Akses dikelola oleh admin <span className="font-semibold text-gray-700">{m.companyName}</span>.
          </p>
        </div>
      </div>
    </div>
  );
}
