import { useCallback, useEffect, useState } from "react";
import { Loader2, Send, Star } from "lucide-react";
import { AvatarImage } from "@/components/profile-edit";
import { WorkerStatsLine } from "@/components/worker-badges";
import { inviteFavorite, listFavorites, removeFavorite, type FavoriteWorker } from "@/lib/favorites-client";

interface Props {
  /** Lowongan aktif milik pemberi kerja yang bisa dipakai untuk mengajak pekerja. */
  jobs: Array<{ id: number; posisi: string }>;
}

/** Daftar pekerja favorit + tombol "Ajak ke lowongan" (notifikasi dalam aplikasi dan email). */
export default function FavoriteWorkersSection({ jobs }: Props) {
  const [items, setItems] = useState<FavoriteWorker[] | null>(null);
  const [error, setError] = useState("");
  const [inviting, setInviting] = useState<string | null>(null);
  const [jobId, setJobId] = useState<number | null>(jobs[0]?.id ?? null);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      setItems(await listFavorites());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat favorit.");
      setItems([]);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (jobId === null && jobs[0]) setJobId(jobs[0].id);
  }, [jobs, jobId]);

  async function invite(workerId: string) {
    if (jobId === null) return;
    setMessage("");
    setError("");
    try {
      await inviteFavorite(workerId, jobId);
      setMessage("Undangan terkirim.");
      setInviting(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal mengirim undangan.");
    }
  }

  async function remove(workerId: string) {
    try {
      await removeFavorite(workerId);
      setItems((prev) => prev?.filter((w) => w.workerId !== workerId) ?? prev);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menghapus.");
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden" data-testid="favorite-workers">
      <div className="px-4 py-3 border-b border-gray-50 flex items-center gap-2">
        <Star className="w-4 h-4 text-amber-500 fill-amber-400" />
        <p className="text-sm font-bold text-gray-900">Pekerja Favorit</p>
      </div>
      {items === null ? (
        <div className="p-4 flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-gray-400" /></div>
      ) : items.length === 0 ? (
        <p className="px-4 py-4 text-xs text-gray-500">
          Belum ada. Setelah menerima pelamar, tekan ikon bintang di kartunya agar mudah mengajaknya bekerja lagi.
        </p>
      ) : (
        <ul className="divide-y divide-gray-50">
          {items.map((w) => (
            <li key={w.workerId} className="px-4 py-3 space-y-2">
              <div className="flex items-center gap-3">
                <AvatarImage
                  src={w.avatarUrl}
                  className="w-10 h-10 rounded-full object-cover shrink-0"
                  fallback={<div className="w-10 h-10 rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center shrink-0">{w.name.charAt(0).toUpperCase()}</div>}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-gray-900 truncate">{w.name}</p>
                  <WorkerStatsLine stats={w.stats} skills={w.skills} />
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  <button
                    type="button"
                    disabled={jobs.length === 0}
                    onClick={() => setInviting(inviting === w.workerId ? null : w.workerId)}
                    className="text-[11px] font-bold bg-primary text-white px-3 py-1.5 rounded-lg disabled:opacity-40"
                  >
                    Ajak
                  </button>
                  <button type="button" onClick={() => void remove(w.workerId)} className="text-[10px] text-gray-400 hover:text-red-500">Hapus</button>
                </div>
              </div>
              {inviting === w.workerId && (
                <div className="flex gap-2 items-center bg-gray-50 rounded-xl p-2">
                  <select
                    value={jobId ?? ""}
                    onChange={(e) => setJobId(Number(e.target.value))}
                    className="flex-1 min-w-0 text-xs rounded-lg border border-gray-200 px-2 py-1.5 bg-white"
                  >
                    {jobs.map((j) => <option key={j.id} value={j.id}>{j.posisi}</option>)}
                  </select>
                  <button type="button" onClick={() => void invite(w.workerId)} className="flex items-center gap-1 text-xs font-bold bg-emerald-600 text-white px-3 py-1.5 rounded-lg">
                    <Send className="w-3 h-3" /> Kirim
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {jobs.length === 0 && items && items.length > 0 && (
        <p className="px-4 pb-3 text-[11px] text-amber-700">Anda perlu lowongan aktif untuk mengajak pekerja.</p>
      )}
      {message && <p className="px-4 pb-3 text-xs font-semibold text-emerald-700">{message}</p>}
      {error && <p role="alert" className="px-4 pb-3 text-xs font-semibold text-red-600">{error}</p>}
    </div>
  );
}
