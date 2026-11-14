import type { ReactElement } from "react";
import { Component, useCallback, useEffect, useState, type ReactNode } from "react";
import { Users, Eye, Building2, Loader2, Check, X, LogOut, ExternalLink, Mail, ChevronRight, ShieldCheck, Search, ChevronDown, FileText } from "lucide-react";
import { EMPTY_FILTERS, filterApplicants, isFiltersActive, requirementProgress, type ApplicantFilters, type SortKey } from "../lib/applicant-filters";
import { ShortlistControls } from "./client-share";

export type TeamRole = "hr" | "supervisor";

/** Event antar-komponen: keanggotaan berubah (terima/keluar) dan permintaan membuka tab Tim. */
export const TEAM_CHANGED_EVENT = "rekhastha:team-changed";
export const OPEN_TEAM_EVENT = "rekhastha:open-team";

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

const ROLE_INFO: Record<TeamRole, {
  label: string; icon: ReactElement; color: string; bg: string; desc: string; can: string[]; cannot: string[];
}> = {
  hr: {
    label: "HR / Rekrutmen", icon: <Users className="w-4 h-4" />, color: "text-primary", bg: "bg-primary/10",
    desc: "Tinjau, terima, dan tolak pelamar",
    can: ["Melihat lamaran dan profil pelamar", "Meninjau, menerima, dan menolak pelamar", "Membuat shortlist dan membagikannya ke klien", "Melihat daftar lowongan"],
    cannot: ["Rekening, NIK, dan NPWP pelamar", "Presensi, pembayaran, dan keuangan"],
  },
  supervisor: {
    label: "Supervisor Lapangan", icon: <Eye className="w-4 h-4" />, color: "text-blue-700", bg: "bg-blue-100",
    desc: "Pantau pekerja dan presensi harian",
    can: ["Melihat lowongan dan pekerja yang diterima", "Memantau presensi masuk dan pulang per hari"],
    cannot: ["Lamaran dan data pelamar", "Pembayaran, keuangan, dan pengaturan tim"],
  },
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
    try {
      await fn(); await load();
      window.dispatchEvent(new Event(TEAM_CHANGED_EVENT));
    }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  };

  if (memberships.length === 0 && invitations.length === 0) return null;

  return (
    // Kartu melayang di bawah header hijau profil, senada dengan kartu lain di aplikasi.
    <div className="relative z-10 -mt-3 space-y-3 px-4 pb-1">
      {invitations.map(inv => {
        const r = ROLE_INFO[inv.role] ?? ROLE_INFO.hr;
        const expires = new Date(inv.expires_at).toLocaleDateString("id-ID", { day: "numeric", month: "short" });
        return (
          <section key={inv.id} className="overflow-hidden rounded-2xl border border-primary/20 bg-white shadow-[0_10px_28px_-10px_rgba(6,95,70,0.35)]">
            <div className="h-1 bg-gradient-to-r from-primary to-primary/50" />
            <div className="p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 text-white shadow-sm">
                  <Mail className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-black uppercase tracking-wider text-primary">Undangan tim</p>
                  <p className="text-sm font-black leading-snug text-gray-900">{inv.company_name} mengundang Anda</p>
                  <span className={`mt-1.5 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-bold ${r.bg} ${r.color}`}>{r.icon} {r.label}</span>
                </div>
              </div>

              <div className="mt-3 grid gap-2 rounded-xl bg-gray-50 p-3 text-[12px] leading-snug">
                <div>
                  <p className="mb-1 font-black text-emerald-700">Yang bisa Anda lakukan</p>
                  <ul className="space-y-0.5 text-gray-700">
                    {r.can.map(t => <li key={t} className="flex gap-1.5"><Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />{t}</li>)}
                  </ul>
                </div>
                <div>
                  <p className="mb-1 font-black text-gray-500">Tidak dapat diakses</p>
                  <ul className="space-y-0.5 text-gray-500">
                    {r.cannot.map(t => <li key={t} className="flex gap-1.5"><X className="mt-0.5 h-3 w-3 shrink-0 text-gray-500" />{t}</li>)}
                  </ul>
                </div>
              </div>

              <div className="mt-3 flex gap-2">
                <button disabled={busy !== null} onClick={() => act(`a${inv.id}`, () => api(`/api/team/invitations/${inv.id}/accept`, { method: "POST" }))}
                  className="flex flex-[1.4] items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2.5 text-xs font-black text-white shadow-sm active:scale-[0.98] disabled:opacity-50">
                  {busy === `a${inv.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Terima undangan
                </button>
                <button disabled={busy !== null} onClick={() => act(`d${inv.id}`, () => api(`/api/team/invitations/${inv.id}/decline`, { method: "POST" }))}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white py-2.5 text-xs font-bold text-gray-600 active:scale-[0.98] disabled:opacity-50">
                  Tolak
                </button>
              </div>
              <p className="mt-2 text-center text-[11px] text-gray-500">Berlaku sampai {expires}</p>
            </div>
          </section>
        );
      })}

      {memberships.map(m => {
        const r = ROLE_INFO[m.role] ?? ROLE_INFO.hr;
        const since = new Date(m.acceptedAt).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
        return (
          <section key={m.companyId} className="overflow-hidden rounded-2xl border border-primary/10 bg-white shadow-[0_10px_28px_-10px_rgba(6,95,70,0.35)]">
            <div className="flex items-center gap-3 p-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 text-white shadow-sm">
                <Building2 className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-black uppercase tracking-wider text-primary">Anggota tim</p>
                <p className="truncate text-sm font-black text-gray-900">{m.companyName}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-gray-500">
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-bold ${r.bg} ${r.color}`}>{r.icon} {r.label}</span>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 border-t border-gray-100 bg-gray-50/80 px-4 py-2 text-[11px] text-gray-500">
              <ShieldCheck className="h-3 w-3 text-emerald-600" /> Aktif sejak {since} · {r.desc}
            </div>
            <details className="group border-t border-gray-100 px-4 py-2.5">
              <summary className="flex cursor-pointer list-none items-center justify-between text-[12px] font-black text-gray-700">
                Hak akses Anda <ChevronDown className="h-3.5 w-3.5 text-gray-500 transition-transform group-open:rotate-180" />
              </summary>
              <div className="mt-2 grid gap-2 rounded-xl bg-gray-50 p-3 text-[12px] leading-snug">
                <div>
                  <p className="mb-1 font-black text-emerald-700">Yang bisa Anda lakukan</p>
                  <ul className="space-y-0.5 text-gray-700">
                    {r.can.map(t => <li key={t} className="flex gap-1.5"><Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />{t}</li>)}
                  </ul>
                </div>
                <div>
                  <p className="mb-1 font-black text-gray-500">Tidak dapat diakses</p>
                  <ul className="space-y-0.5 text-gray-500">
                    {r.cannot.map(t => <li key={t} className="flex gap-1.5"><X className="mt-0.5 h-3 w-3 shrink-0 text-gray-500" />{t}</li>)}
                  </ul>
                </div>
              </div>
            </details>
            <div className="flex items-center gap-2 px-4 py-3">
              <button type="button" onClick={() => window.dispatchEvent(new Event(OPEN_TEAM_EVENT))}
                className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-primary py-2.5 text-xs font-black text-white shadow-sm active:scale-[0.98]">
                Buka ruang kerja <ChevronRight className="h-3.5 w-3.5" />
              </button>
              <button disabled={busy !== null}
                onClick={() => { if (confirm(`Keluar dari tim ${m.companyName}?`)) void act(`l${m.companyId}`, () => api(`/api/team/membership/${m.companyId}`, { method: "DELETE" })); }}
                className="flex items-center gap-1 rounded-xl px-3 py-2.5 text-[12px] font-bold text-gray-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50">
                <LogOut className="h-3 w-3" /> Keluar
              </button>
            </div>
          </section>
        );
      })}
      {error && <p className="px-1 text-xs font-semibold text-red-600">{error}</p>}
    </div>
  );
}

/* ───────────────────────── Ruang kerja anggota tim ───────────────────────── */

interface WorkerApplication {
  id: number; jobId: number; jobTitle: string; workerName: string; status: string; createdAt: string;
  cvLink?: string | null; portfolioLink?: string | null;
  supportingInfo?: { experience?: string; education?: string; skills?: string; availability?: string } | null;
  shortlistedAt?: string | null; clientDecision?: "setuju" | "tidak" | null; clientNote?: string | null;
  workerSkills: string[];
  workerStats: { ratingAvg: number | null; ratingCount: number; completedJobs: number };
  dataDiri?: { usia: number | null; jenisKelamin: "L" | "P" | null; tempatLahir: string | null; terverifikasi: boolean } | null;
  applicationQuestions?: { id: string; prompt: string; required: boolean; answerType: string }[] | null;
  applicationAnswers?: Record<string, string> | null;
  uploadedFiles?: { id: number; questionId?: string | null; fileName: string; kind: string; url: string }[] | null;
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

function ApplicantDetail({ a }: { a: WorkerApplication }) {
  const d = a.dataDiri;
  const qs = a.applicationQuestions ?? [];
  const files = a.uploadedFiles ?? [];
  const info = a.supportingInfo ?? {};
  const Field = ({ k, v }: { k: string; v: string }) => v ? <div><dt className="text-[11px] font-bold uppercase text-gray-500">{k}</dt><dd className="text-xs text-gray-700 break-words whitespace-pre-wrap">{v}</dd></div> : null;
  return (
    <div className="mt-3 space-y-3 border-t border-gray-100 pt-3">
      <section>
        <h4 className="text-[12px] font-black text-gray-500 uppercase tracking-wide mb-1.5">Data diri</h4>
        <dl className="grid grid-cols-2 gap-2">
          <Field k="Nama" v={a.workerName} />
          <Field k="Usia" v={d?.usia != null ? `${d.usia} tahun` : ""} />
          <Field k="Jenis kelamin" v={d?.jenisKelamin === "L" ? "Laki-laki" : d?.jenisKelamin === "P" ? "Perempuan" : ""} />
          <Field k="Tempat lahir" v={d?.tempatLahir ?? ""} />
          <Field k="Akun" v={d ? (d.terverifikasi ? "Identitas terverifikasi" : "Belum terverifikasi") : ""} />
          <Field k="Pengalaman" v={String(info.experience ?? "")} />
          <Field k="Pendidikan" v={String(info.education ?? "")} />
          <Field k="Ketersediaan" v={String(info.availability ?? "")} />
        </dl>
        <p className="mt-1.5 text-[11px] text-gray-500">NIK, rekening, NPWP, dan kontak pribadi tidak ditampilkan di ruang kerja tim.</p>
      </section>
      <section>
        <h4 className="text-[12px] font-black text-gray-500 uppercase tracking-wide mb-1.5">Pertanyaan &amp; jawaban</h4>
        {qs.length === 0 ? <p className="text-xs text-gray-500">Lowongan ini tidak punya pertanyaan tambahan.</p> : (
          <div className="space-y-2">
            {qs.map(q => {
              const f = files.find(x => x.questionId === q.id);
              const isFile = q.answerType === "photo" || q.answerType === "file";
              const ans = (a.applicationAnswers?.[q.id] ?? "").trim();
              return (
                <div key={q.id} className="rounded-xl bg-gray-50 px-3 py-2">
                  <p className="text-[12px] font-bold text-gray-700">{q.prompt}{q.required && <span className="text-red-500"> *</span>}</p>
                  {isFile
                    ? (f ? <a href={f.url} target="_blank" rel="noopener noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-xs font-bold text-primary"><FileText className="w-3 h-3" />{f.fileName}</a>
                         : <p className={`mt-0.5 text-xs font-semibold ${q.required ? "text-red-500" : "text-gray-500"}`}>Belum dilampirkan</p>)
                    : <p className={`mt-0.5 text-xs break-words whitespace-pre-wrap ${ans ? "text-gray-700" : "text-gray-500"}`}>{ans || "Tidak dijawab"}</p>}
                </div>
              );
            })}
          </div>
        )}
        {files.filter(f => !f.questionId).length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {files.filter(f => !f.questionId).map(f => <a key={f.id} href={f.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12px] font-bold text-primary"><FileText className="w-3 h-3" />{f.fileName}</a>)}
          </div>
        )}
      </section>
    </div>
  );
}

function ApplicationsPanel({ companyId, canDecide }: { companyId: string; canDecide: boolean }) {
  const [rows, setRows] = useState<WorkerApplication[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState<ApplicantFilters>(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [open, setOpen] = useState<Set<number>>(new Set());

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
  const toggle = (id: number) => setOpen(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const set = <K extends keyof ApplicantFilters>(k: K, v: ApplicantFilters[K]) => setFilters(f => ({ ...f, [k]: v }));

  if (!rows) return <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-gray-500" /></div>;
  const jobs = Array.from(new Map(rows.map(r => [r.jobId, r.jobTitle])).entries());
  const shown = filterApplicants(rows, filters);
  const active = isFiltersActive(filters);
  const chip = (on: boolean) => `px-2.5 py-1 rounded-full text-[12px] font-bold border ${on ? "bg-primary text-white border-primary" : "bg-white text-gray-600 border-gray-200"}`;
  const sel = "px-2.5 py-2 border border-gray-200 rounded-xl text-xs bg-white";

  return (
    <div className="space-y-2">
      <div className="bg-white rounded-2xl border border-gray-100 p-3 space-y-2">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input data-testid="input-ats-search" value={filters.search} onChange={e => set("search", e.target.value)} placeholder="Cari nama, keahlian, atau isi jawaban"
              className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-xl text-xs bg-white" />
          </div>
          <button onClick={() => setShowFilters(v => !v)} className={`px-3 rounded-xl border text-xs font-bold flex items-center gap-1 ${showFilters || active ? "border-primary/30 text-primary bg-primary/5" : "border-gray-200 text-gray-600"}`}>
            Filter <ChevronDown className={`w-3 h-3 transition-transform ${showFilters ? "rotate-180" : ""}`} />
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[["", "Semua"], ["baru", "Baru"], ["ditinjau", "Ditinjau"], ["diterima", "Diterima"], ["ditolak", "Ditolak"]].map(([v, l]) => (
            <button key={v} onClick={() => set("status", v)} className={chip(filters.status === v)}>{l}</button>
          ))}
        </div>
        {showFilters && (
          <div className="grid grid-cols-2 gap-2 pt-1">
            <select value={filters.jobId ?? ""} onChange={e => set("jobId", e.target.value ? Number(e.target.value) : null)} className={`${sel} col-span-2`}>
              <option value="">Semua lowongan</option>
              {jobs.map(([id, t]) => <option key={id} value={id}>{t}</option>)}
            </select>
            <select value={filters.shortlist} onChange={e => set("shortlist", e.target.value as ApplicantFilters["shortlist"])} className={sel}>
              <option value="">Shortlist: semua</option><option value="ya">Sudah di shortlist</option><option value="belum">Belum di shortlist</option>
            </select>
            <select value={filters.klien} onChange={e => set("klien", e.target.value as ApplicantFilters["klien"])} className={sel}>
              <option value="">Penilaian klien: semua</option><option value="setuju">Disetujui klien</option><option value="tidak">Ditolak klien</option><option value="belum">Menunggu klien</option>
            </select>
            <select value={filters.minRating} onChange={e => set("minRating", Number(e.target.value))} className={sel}>
              <option value={0}>Rating: bebas</option><option value={3}>★ 3+</option><option value={4}>★ 4+</option><option value={4.5}>★ 4.5+</option>
            </select>
            <select value={filters.minJobs} onChange={e => set("minJobs", Number(e.target.value))} className={sel}>
              <option value={0}>Pengalaman: bebas</option><option value={1}>1+ pekerjaan</option><option value={5}>5+ pekerjaan</option><option value={10}>10+ pekerjaan</option>
            </select>
            <label className="col-span-2 flex items-center gap-2 text-xs font-semibold text-gray-600">
              <input type="checkbox" checked={filters.syaratLengkap} onChange={e => set("syaratLengkap", e.target.checked)} /> Hanya yang syarat wajibnya lengkap
            </label>
            <select value={filters.sort} onChange={e => set("sort", e.target.value as SortKey)} className={`${sel} col-span-2`}>
              <option value="terbaru">Urutkan: terbaru</option><option value="rating">Urutkan: rating tertinggi</option><option value="pengalaman">Urutkan: pekerjaan terbanyak</option><option value="nama">Urutkan: nama A–Z</option>
            </select>
          </div>
        )}
        <div className="flex items-center justify-between text-[12px] text-gray-500">
          <span data-testid="text-ats-count">{shown.length} dari {rows.length} pelamar</span>
          {active && <button onClick={() => setFilters(f => ({ ...EMPTY_FILTERS, sort: f.sort }))} className="font-bold text-primary">Reset filter</button>}
        </div>
      </div>
      {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
      {rows.length === 0 && <p className="py-8 text-center text-sm text-gray-500">Belum ada lamaran.</p>}
      {rows.length > 0 && shown.length === 0 && <p className="py-8 text-center text-sm text-gray-500">Tidak ada pelamar yang cocok dengan filter.</p>}
      {shown.map(a => {
        const prog = requirementProgress(a);
        const isOpen = open.has(a.id);
        return (
        <div key={a.id} className="bg-white rounded-2xl border border-gray-100 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-bold text-gray-900 truncate">{a.workerName}</p>
              <p className="text-[12px] text-gray-500 truncate">Melamar: {a.jobTitle}</p>
            </div>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 shrink-0">{STATUS_LABEL[a.status] ?? a.status}</span>
          </div>
          <p className="text-[12px] text-gray-500 mt-1">
            {a.workerStats?.completedJobs ?? 0} pekerjaan selesai{a.workerStats?.ratingAvg != null ? ` · ★ ${Number(a.workerStats.ratingAvg).toFixed(1)} (${a.workerStats.ratingCount})` : ""}
            {a.dataDiri?.usia != null ? ` · ${a.dataDiri.usia} th` : ""}
          </p>
          {Array.isArray(a.workerSkills) && a.workerSkills.length > 0 && <p className="text-[12px] text-gray-500 mt-1 truncate">{a.workerSkills.slice(0, 5).join(" · ")}</p>}
          {prog.total > 0 && (
            <p className={`mt-1.5 inline-block text-[11px] font-bold px-2 py-0.5 rounded-full ${prog.done === prog.total ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
              Syarat wajib {prog.done}/{prog.total}
            </p>
          )}
          <div className="flex gap-3 mt-2">
            {a.cvLink && <a href={a.cvLink} target="_blank" rel="noopener noreferrer" className="text-[12px] font-bold text-primary flex items-center gap-1">CV <ExternalLink className="w-3 h-3" /></a>}
            {a.portfolioLink && <a href={a.portfolioLink} target="_blank" rel="noopener noreferrer" className="text-[12px] font-bold text-primary flex items-center gap-1">Portofolio <ExternalLink className="w-3 h-3" /></a>}
          </div>
          <button data-testid={`button-detail-${a.id}`} onClick={() => toggle(a.id)} className="mt-2 w-full py-2 rounded-xl bg-gray-50 text-xs font-bold text-gray-700 flex items-center justify-center gap-1">
            {isOpen ? "Sembunyikan detail" : "Lihat data diri, pertanyaan & jawaban"} <ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? "rotate-180" : ""}`} />
          </button>
          {isOpen && <ApplicantDetail a={a} />}
          {canDecide && !isOpen && <p className="mt-3 text-[12px] text-gray-500">Tinjau data diri &amp; jawaban dulu sebelum memasukkan ke shortlist.</p>}
          {canDecide && isOpen && (
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
        );
      })}
    </div>
  );
}

function GigsPanel({ companyId }: { companyId: string }) {
  const [gigs, setGigs] = useState<GigRow[] | null>(null);
  useEffect(() => {
    api<{ gigs: GigRow[] }>(`/api/team/company/${companyId}/gigs`).then(d => setGigs(d.gigs)).catch(() => setGigs([]));
  }, [companyId]);
  if (!gigs) return <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-gray-500" /></div>;
  if (gigs.length === 0) return <p className="py-8 text-center text-sm text-gray-500">Belum ada lowongan aktif.</p>;
  return (
    <div className="space-y-2">
      {gigs.map(g => (
        <div key={g.id} className="bg-white rounded-2xl border border-gray-100 p-4">
          <p className="text-sm font-bold text-gray-900">{g.posisi}</p>
          <p className="text-[12px] text-gray-500 mt-0.5">{[g.jobDate, g.jamKerja, g.alamat].filter(Boolean).join(" · ")}</p>
          <p className="text-[12px] font-bold text-gray-500 mt-2 uppercase tracking-wide">Pekerja ({(g.workers ?? []).length}{g.kuota ? `/${g.kuota}` : ""})</p>
          {(g.workers ?? []).length === 0
            ? <p className="text-xs text-gray-500 mt-1">Belum ada pekerja diterima.</p>
            : <ul className="mt-1 space-y-0.5">{(g.workers ?? []).map(w => <li key={w.applicationId} className="text-xs text-gray-700">• {w.workerName}</li>)}</ul>}
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
      {!rows ? <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-gray-500" /></div>
        : rows.length === 0 ? <p className="py-8 text-center text-sm text-gray-500">Belum ada presensi pada tanggal ini.</p>
        : <div className="space-y-2">{rows.map(r => (
            <div key={r.id} className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-bold text-gray-900 truncate">{r.workerName}</p>
                <p className="text-[12px] text-gray-500 truncate">{r.jobTitle}</p>
              </div>
              <div className="text-right shrink-0">
                <p className={`text-[12px] font-black ${r.kind === "masuk" ? "text-emerald-600" : "text-blue-600"}`}>{r.kind === "masuk" ? "Masuk" : "Pulang"}</p>
                <p className="text-[11px] text-gray-500">{new Date(r.at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" })}</p>
              </div>
            </div>))}</div>}
    </div>
  );
}

/** Ruang kerja anggota tim — isi menyesuaikan hak peran. */
function TeamWorkspaceInner({ memberships }: { memberships: Membership[] }) {
  const [activeId, setActiveId] = useState(memberships[0]?.companyId ?? "");
  const m = memberships.find(x => x.companyId === activeId) ?? memberships[0];
  const [tab, setTab] = useState<"applications" | "gigs" | "attendance" | null>(null);
  if (!m) return null;
  const r = ROLE_INFO[m.role] ?? ROLE_INFO.hr;
  const can = (p: string) => m.permissions.includes(p);
  const tabs = [
    can("applications.view") && { key: "applications" as const, label: "Lamaran" },
    can("gigs.view") && { key: "gigs" as const, label: "Lowongan" },
    can("attendance.view") && { key: "attendance" as const, label: "Presensi" },
  ].filter(Boolean) as { key: "applications" | "gigs" | "attendance"; label: string }[];
  const current = tab && tabs.some(t => t.key === tab) ? tab : tabs[0]?.key;

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
              className={`px-4 py-2 rounded-full text-xs font-bold ${current === t.key ? "bg-primary text-white" : "bg-white border border-gray-200 text-gray-600"}`}>{t.label}</button>
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

class WorkspaceBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.error("[tim] ruang kerja gagal ditampilkan", error); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-base font-black text-gray-900">Ruang kerja tim gagal ditampilkan</p>
        <p className="text-sm text-gray-500">Terjadi kesalahan saat memuat data. Coba muat ulang halaman.</p>
        <button onClick={() => window.location.reload()} className="rounded-xl bg-primary px-4 py-2 text-sm font-black text-white">Muat ulang</button>
      </div>
    );
  }
}

/** Ruang kerja anggota tim — dibungkus pengaman agar error tampilan tidak membuat halaman blank. */
export function TeamMemberBisnisView({ memberships }: { memberships: Membership[] }) {
  return <WorkspaceBoundary><TeamWorkspaceInner memberships={memberships} /></WorkspaceBoundary>;
}
