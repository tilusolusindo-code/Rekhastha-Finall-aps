import { useState, useEffect, useCallback } from "react";
import { Users, Mail, Trash2, Plus, Crown, Shield, Calculator, Eye, Loader2, CheckCircle2, X } from "lucide-react";

interface TeamMember {
  id: number;
  member_id: string;
  name: string;
  email: string;
  role: "hr" | "supervisor" | "finance";
  invited_at: string;
  accepted_at: string | null;
}

const ROLE_INFO = {
  hr:         { label: "HR / Rekrutmen",      icon: <Users className="w-3.5 h-3.5" />,      color: "text-violet-700", bg: "bg-violet-100",  desc: "Lihat lamaran & kelola pekerja" },
  supervisor: { label: "Supervisor Lapangan", icon: <Eye className="w-3.5 h-3.5" />,        color: "text-blue-700",   bg: "bg-blue-100",    desc: "Lihat presensi & gig yang ditugaskan" },
  finance:    { label: "Keuangan",            icon: <Calculator className="w-3.5 h-3.5" />, color: "text-amber-700",  bg: "bg-amber-100",   desc: "Lihat & export laporan keuangan" },
};

async function fetchTeam(): Promise<TeamMember[]> {
  const res = await fetch("/api/team", { credentials: "same-origin" });
  if (!res.ok) throw new Error("Gagal memuat tim");
  const data = await res.json();
  return data.members ?? [];
}

async function inviteMember(email: string, role: string): Promise<void> {
  const res = await fetch("/api/team/invite", {
    method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, role }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error ?? "Gagal mengirim undangan");
  }
}

async function removeMember(memberId: string): Promise<void> {
  const res = await fetch(`/api/team/${memberId}`, { method: "DELETE", credentials: "same-origin" });
  if (!res.ok) throw new Error("Gagal menghapus anggota");
}

export default function TeamManager({ onClose }: { onClose: () => void }) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"hr" | "supervisor" | "finance">("hr");
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setMembers(await fetchTeam());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.includes("@")) return;
    setInviting(true); setInviteMsg(null);
    try {
      const res = await fetch("/api/team/invite", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Gagal mengirim undangan");
      const msg = data.directAdded
        ? `${inviteEmail} langsung ditambahkan ke tim`
        : `Undangan dikirim ke ${inviteEmail}`;
      setInviteMsg({ ok: true, text: msg });
      setInviteEmail("");
      void load(); // refresh daftar anggota
    } catch (err) {
      setInviteMsg({ ok: false, text: (err as Error).message });
    } finally { setInviting(false); }
  };

  const handleRemove = async (m: TeamMember) => {
    if (!confirm(`Hapus ${m.name} dari tim?`)) return;
    setRemovingId(m.member_id);
    try {
      await removeMember(m.member_id);
      setMembers(prev => prev.filter(x => x.member_id !== m.member_id));
    } catch { /* ignore */ }
    finally { setRemovingId(null); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-lg max-h-[92dvh] overflow-y-auto shadow-2xl">
        {/* Header */}
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
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200">✕</button>
        </div>

        <div className="p-5 space-y-5">
          {/* Role info */}
          <div className="grid grid-cols-3 gap-2">
            {(Object.entries(ROLE_INFO) as [string, typeof ROLE_INFO["hr"]][]).map(([key, r]) => (
              <div key={key} className={`${r.bg} rounded-xl p-3 text-center`}>
                <div className={`${r.color} flex justify-center mb-1`}>{r.icon}</div>
                <p className={`text-[10px] font-black ${r.color}`}>{r.label}</p>
                <p className="text-[9px] text-gray-500 mt-0.5 leading-tight">{r.desc}</p>
              </div>
            ))}
          </div>

          {/* Invite form */}
          <div className="bg-gray-50 rounded-2xl p-4 border border-gray-200">
            <p className="text-xs font-black text-gray-700 mb-3 flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5" /> Undang Anggota Baru
            </p>
            <form onSubmit={handleInvite} className="space-y-3">
              <div>
                <label className="text-[11px] font-bold text-gray-500 block mb-1">Email (harus sudah daftar di Rekhastha)</label>
                <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                  placeholder="email@perusahaan.com"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-violet-500 bg-white" />
              </div>
              <div>
                <label className="text-[11px] font-bold text-gray-500 block mb-1">Role</label>
                <div className="flex rounded-xl border border-gray-200 overflow-hidden bg-white">
                  {(["hr", "supervisor", "finance"] as const).map(r => (
                    <button key={r} type="button" onClick={() => setInviteRole(r)}
                      className={`flex-1 py-2 text-[11px] font-bold transition-colors ${
                        inviteRole === r ? "bg-violet-700 text-white" : "text-gray-500 hover:bg-gray-50"
                      }`}>
                      {r === "hr" ? "HR" : r === "supervisor" ? "Supervisor" : "Finance"}
                    </button>
                  ))}
                </div>
              </div>
              {inviteMsg && (
                <div className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold ${
                  inviteMsg.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                }`}>
                  {inviteMsg.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                  {inviteMsg.text}
                </div>
              )}
              <button type="submit" disabled={inviting || !inviteEmail}
                className="w-full bg-violet-700 hover:bg-violet-600 disabled:opacity-50 text-white font-black py-2.5 rounded-xl text-sm flex items-center justify-center gap-2">
                {inviting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                {inviting ? "Mengirim..." : "Kirim Undangan"}
              </button>
            </form>
          </div>

          {/* Member list */}
          <div>
            <p className="text-xs font-black text-gray-700 mb-3 flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" /> Anggota Tim ({members.length})
            </p>
            {loading ? (
              <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
            ) : members.length === 0 ? (
              <div className="py-8 text-center text-sm text-gray-400">Belum ada anggota tim.</div>
            ) : (
              <div className="space-y-2">
                {members.map(m => {
                  const r = ROLE_INFO[m.role];
                  return (
                    <div key={m.id} className="bg-white border border-gray-200 rounded-xl p-3.5 flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-xl ${r.bg} ${r.color} flex items-center justify-center shrink-0 font-black text-sm`}>
                        {m.name[0]?.toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-bold text-gray-900 truncate">{m.name}</p>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${r.bg} ${r.color}`}>
                            {r.label}
                          </span>
                        </div>
                        <p className="text-xs text-gray-400 truncate">{m.email}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          {m.accepted_at ? "✓ Aktif" : "⏳ Menunggu penerimaan"}
                        </p>
                      </div>
                      <button onClick={() => handleRemove(m)} disabled={removingId === m.member_id}
                        className="w-8 h-8 rounded-xl bg-red-50 text-red-500 hover:bg-red-100 flex items-center justify-center shrink-0 disabled:opacity-40">
                        {removingId === m.member_id
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <p className="text-[11px] text-gray-400 text-center leading-relaxed">
            Fitur tim tersedia untuk paket <span className="font-bold">Business 12 Bulan</span>.
            Anggota tim harus sudah memiliki akun Rekhastha dengan email yang sama.
          </p>
        </div>
      </div>
    </div>
  );
}
