import { useState } from "react";
import { Star } from "lucide-react";
import { addFavorite, removeFavorite } from "@/lib/favorites-client";

interface Stats {
  ratingAvg: number | null;
  ratingCount: number;
  completedJobs: number;
}

/** Ringkasan reputasi pekerja: rating, pekerjaan selesai, dan beberapa skill. */
export function WorkerStatsLine({ stats, skills }: { stats?: Stats; skills?: string[] }) {
  if (!stats) return null;
  const isNew = stats.completedJobs === 0 && stats.ratingCount === 0;
  return (
    <div className="mt-1 space-y-1">
      <p className="text-[10px] text-gray-500 flex items-center gap-1 flex-wrap">
        {isNew ? (
          <span className="font-semibold text-blue-600">Pekerja baru</span>
        ) : (
          <>
            {stats.ratingAvg !== null && (
              <span className="inline-flex items-center gap-0.5 font-bold text-amber-600">
                <Star className="w-3 h-3 fill-amber-400 text-amber-400" /> {stats.ratingAvg.toFixed(1)}
                <span className="font-normal text-gray-400">({stats.ratingCount})</span>
              </span>
            )}
            <span>{stats.completedJobs} pekerjaan selesai</span>
          </>
        )}
      </p>
      {skills && skills.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {skills.slice(0, 3).map((s) => (
            <span key={s} className="text-[9px] font-semibold bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">{s}</span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Bintang favorit; hanya bermakna untuk pekerja yang pernah diterima pemberi kerja. */
export function FavoriteStar({ workerId, initial, onChange }: { workerId: string; initial: boolean; onChange?: (value: boolean) => void }) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function toggle() {
    setBusy(true);
    setError("");
    try {
      if (on) await removeFavorite(workerId);
      else await addFavorite(workerId);
      setOn(!on);
      onChange?.(!on);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="inline-flex flex-col items-center">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={busy}
        aria-pressed={on}
        aria-label={on ? "Hapus dari pekerja favorit" : "Tambah ke pekerja favorit"}
        className={`p-1.5 rounded-lg border transition-colors disabled:opacity-50 ${on ? "bg-amber-50 border-amber-300" : "bg-white border-gray-200 hover:bg-gray-50"}`}
      >
        <Star className={`w-4 h-4 ${on ? "fill-amber-400 text-amber-400" : "text-gray-400"}`} />
      </button>
      {error && <span className="text-[9px] text-red-600 max-w-[110px] text-center">{error}</span>}
    </span>
  );
}
