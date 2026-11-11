export interface FavoriteWorker {
  workerId: string;
  name: string;
  avatarUrl: string | null;
  skills: string[];
  stats: { ratingAvg: number | null; ratingCount: number; completedJobs: number };
}

async function call<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Terjadi kesalahan.");
  return data as T;
}

export const listFavorites = () => call<FavoriteWorker[]>("/favorites", "GET");
export const addFavorite = (workerId: string) => call<{ ok: true }>(`/favorites/${encodeURIComponent(workerId)}`, "PUT");
export const removeFavorite = (workerId: string) => call<{ ok: true }>(`/favorites/${encodeURIComponent(workerId)}`, "DELETE");
export const inviteFavorite = (workerId: string, jobId: number) =>
  call<{ ok: true }>(`/favorites/${encodeURIComponent(workerId)}/invite`, "POST", { jobId });
