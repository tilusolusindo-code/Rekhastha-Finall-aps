import type { ReactElement } from "react";
import { useState, useEffect, useCallback } from "react";
import { Users, Mail, Trash2, Plus, Eye, Loader2, CheckCircle2, X, Clock } from "lucide-react";

type TeamRole = "hr" | "supervisor";

interface TeamMember {
  id: number;
  member_id: string;
  name: string;
  email: string;
  role: TeamRole;
  invited_at: string;
  accepted_at: string | null;
}

interface PendingInvitation {
  id: number;
  email: string;
  role: TeamRole;
  expires_at: string;
}

const ROLE_INFO: Record<TeamRole, { label: string; short: string; icon: ReactElement; color: string; bg: string; can: string[] }> = {
  hr: {
    label: "HR / Rekrutmen", short: "HR", icon: <Users className="w-3.5 h-3.5" />, color: "text-violet-700", bg: "bg-violet-100",
    can: ["Lihat lamaran (tanpa rekening & NIK)", "Tinjau, terima & tolak pelamar", "Lihat daftar lowongan"],
  },
  supervisor: {
    label: "Supervisor Lapangan", short: "Supervisor", icon: <Eye className="w-3.5 h-3.5" />, color: "text-blue-700", bg: "bg-blue-100",
    can: ["Lihat lowongan & pekerja yang diterima", "Pantau presensi harian"],
  },
};

const ROLES: TeamRole[] = ["hr", "supervisor"];

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Terjadi kesalahan. Coba lagi.");
  return data as Record<string, unknown>;
}

export default function TeamManager({ onClose }: { onClose: () => void }) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [maxSlots, setMaxSlots] = useState(10);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<TeamRole>("hr");
  const [inviting, setInviting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api("/api/team");
      setMembers((d["members"] as TeamMember[]) ?? []);
      setInvitations((d["invitations"] as PendingInvitation[]) ?? []);
      if (typeof d["maxSlots"] === "number") setMaxSlots(d["maxSlots"]);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.includes("@")) return;
    setInviting(true); setMsg(null);
    try {
      const d = await api("/api/team/invite", { method: "POST", body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }) });
      setMsg({ ok: true, text: String(d["message"] ?? "Undangan dikirim.") });
      setInviteEmail("");
      void load();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally { setInviting(false); }
  };

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusyKey(key); setMsg(null);
    try { await fn(); await load(); }
    catch (err) { setMsg({ ok: false, text: (err as Error).message }); }
    finally { setBusyKey(null); }
  };

  const handleRemove = (m: TeamMember) => {
    if (!confirm(`Keluarkan ${m.name} dari tim? Aksesnya langsung dicabut.`)) return;
    void run(`m${m.member_id}`, () => api(`/api/team/${m.member_id}`, { method: "DELETE" }));
  };
  const handleRole = (m: TeamMember, role: TeamRole) => {
    if (role === m.role) return;
    void run(`m${m.member_id}`, () => api(`/api/team/${m.member_id}`, { method: "PATCH", body: JSON.stringify({ role }) }));
  };
  const handleCancelInvite = (i: PendingInvitation) =>
    void run(`i${i.id}`, () => api(`/api/team/invitations/${i.id}`, { method: "DELETE" }));

  const used = members.length + invitations.length;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-lg max-h-[92dvh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-white z-10 px-5 pt-5 pb-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-violet-100 flex items-center justify-center">
              <Users className="w-4 h-4 text-violet-700" />
            </div>
            <div>
              <h2 className="text-base font-black text-gray-900">Kelola Tim</h2>
              <p className="text-[11px] text-gray-400">Undang anggota tim dengan akses terbatas</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Tutup" className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200">✕</button>
        </div>

        <div className="p-5 space-y-5">
          <div className="grid grid-cols-2 gap-2">
            {ROLES.map(key => {
              const r = ROLE_INFO[key];
              return (
                <div key={key} className={`${r.bg} rounded-xl p-3`}>
                  <div className={`${r.color} flex items-center gap-1.5 mb-1.5`}>{r.icon}<p className="text-[11px] font-black">{r.label}</p></div>
                  <ul className="space-y-0.5">
                    {r.can.map(c => <li key={c} className="text-[10px] text-gray-600 leading-tight">• {c}</li>)}
                  </ul>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-gray-500 leading-relaxed -mt-2">
            Anggota tidak bisa melihat data keuangan, rekening, atau NIK pelamar, dan tidak bisa mengubah lowongan, pembayaran, atau tim.
          </p>

          <div className="bg-gray-50 rounded-2xl p-4 border border-gray-200">
            <p className="text-xs font-black text-gray-700 mb-3 flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5" /> Undang Anggota Baru
              <span className="ml-auto text-[10px] font-semibold text-gray-400">{used}/{maxSlots} terpakai</span>
            </p>
            <form onSubmit={handleInvite} className="space-y-3">
              <div>
                <label className="text-[11px] font-bold text-gray-500 block mb-1">Email (akun pekerja Rekhastha)</label>
                <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                  placeholder="email@contoh.com"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-violet-500 bg-white" />
              </div>
              <div>
                <label className="text-[11px] font-bold text-gray-500 block mb-1">Peran</label>
                <div className="flex rounded-xl border border-gray-200 overflow-hidden bg-white">
                  {ROLES.map(r => (
                    <button key={r} type="button" onClick={() => setInviteRole(r)}
                      className={`flex-1 py-2 text-[11px] font-bold transition-colors ${inviteRole === r ? "bg-violet-700 text-white" : "text-gray-500 hover:bg-gray-50"}`}>
                      {ROLE_INFO[r].short}
                    </button>
                  ))}
                </div>
              </div>
              {msg && (
                <div className={`flex items-start gap-2 px-3 py-2 rounded-xl text-xs font-semibold ${msg.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                  {msg.ok ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" /> : <X className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
                  <span>{msg.text}</span>
                </div>
              )}
              <button type="submit" disabled={inviting || !inviteEmail}
                className="w-full bg-violet-700 hover:bg-violet-600 disabled:opacity-50 text-white font-black py-2.5 rounded-xl text-sm flex items-center justify-center gap-2">
                {inviting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                {inviting ? "Mengirim..." : "Kirim Undangan"}
              </button>
            </form>
          </div>

          {invitations.length > 0 && (
            <div>
              <p className="text-xs font-black text-gray-700 mb-3 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" /> Menunggu Diterima ({invitations.length})
              </p>
              <div className="space-y-2">
                {invitations.map(i => (
                  <div key={i.id} className="bg-amber-50 border border-amber-100 rounded-xl p-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-gray-900 truncate">{i.email}</p>
                      <p className="text-[11px] text-gray-500">
                        {ROLE_INFO[i.role]?.label ?? i.role} · berlaku sampai {new Date(i.expires_at).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}
                      </p>
                    </div>
                    <button onClick={() => handleCancelInvite(i)} disabled={busyKey === `i${i.id}`}
                      className="px-3 py-1.5 rounded-lg bg-white border border-amber-200 text-[11px] font-bold text-amber-700 hover:bg-amber-100 disabled:opacity-40">
                      Batalkan
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="text-xs font-black text-gray-700 mb-3 flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" /> Anggota Aktif ({members.length})
            </p>
            {loading ? (
              <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
            ) : members.length === 0 ? (
              <div className="py-8 text-center text-sm text-gray-400">Belum ada anggota tim.</div>
            ) : (
              <div className="space-y-2">
                {members.map(m => {
                  const r = ROLE_INFO[m.role] ?? ROLE_INFO.hr;
                  const busy = busyKey === `m${m.member_id}`;
                  return (
                    <div key={m.id} className="bg-white border border-gray-200 rounded-xl p-3.5 flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-xl ${r.bg} ${r.color} flex items-center justify-center shrink-0 font-black text-sm`}>
                        {m.name[0]?.toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-gray-900 truncate">{m.name}</p>
                        <p className="text-xs text-gray-400 truncate">{m.email}</p>
                        <select value={m.role} disabled={busy} onChange={e => handleRole(m, e.target.value as TeamRole)}
                          aria-label={`Peran ${m.name}`}
                          className={`mt-1 text-[11px] font-bold rounded-lg px-2 py-1 border-0 ${r.bg} ${r.color}`}>
                          {ROLES.map(k => <option key={k} value={k}>{ROLE_INFO[k].label}</option>)}
                        </select>
                      </div>
                      <button onClick={() => handleRemove(m)} disabled={busy} aria-label={`Keluarkan ${m.name}`}
                        className="w-8 h-8 rounded-xl bg-red-50 text-red-500 hover:bg-red-100 flex items-center justify-center shrink-0 disabled:opacity-40">
                        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <p className="text-[11px] text-gray-400 text-center leading-relaxed">
            Fitur tim tersedia selama paket <span className="font-bold">Bisnis</span> aktif. Jika paket berakhir, akses anggota otomatis berhenti.
            Undangan harus diterima oleh yang bersangkutan (akun pekerja dengan email yang sama).
          </p>
        </div>
      </div>
    </div>
  );
}
