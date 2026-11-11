import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

export interface WorkerStats {
  ratingAvg: number | null;
  ratingCount: number;
  completedJobs: number;
}

/**
 * Statistik publik pekerja: rata-rata rating dari pemberi kerja, jumlah rating,
 * dan jumlah pekerjaan selesai. Rating dikaitkan ke pekerja lewat lamaran pada
 * lowongan yang sama dan nama sasaran yang sama (tabel ratings tidak menyimpan id pekerja).
 */
export async function getWorkerStats(workerIds: string[]): Promise<Map<string, WorkerStats>> {
  const result = new Map<string, WorkerStats>();
  const ids = [...new Set(workerIds)].filter(Boolean);
  if (ids.length === 0) return result;
  const list = sql.join(ids.map((id) => sql`${id}`), sql`, `);

  const completed = await db.execute<{ worker_id: string; n: number }>(sql`
    SELECT worker_id, count(*)::int AS n
    FROM applications
    WHERE status = 'selesai' AND worker_id IN (${list})
    GROUP BY worker_id
  `);
  const rated = await db.execute<{ worker_id: string; avg: number; n: number }>(sql`
    SELECT a.worker_id, avg(r.score)::float AS avg, count(DISTINCT r.id)::int AS n
    FROM ratings r
    JOIN applications a ON a.job_id = r.job_id AND a.worker_name = r.target_name
    WHERE r.rater_type = 'company' AND a.worker_id IN (${list})
    GROUP BY a.worker_id
  `);

  for (const id of ids) result.set(id, { ratingAvg: null, ratingCount: 0, completedJobs: 0 });
  for (const row of completed.rows) {
    const s = result.get(row.worker_id);
    if (s) s.completedJobs = Number(row.n);
  }
  for (const row of rated.rows) {
    const s = result.get(row.worker_id);
    if (s) {
      s.ratingAvg = Math.round(Number(row.avg) * 10) / 10;
      s.ratingCount = Number(row.n);
    }
  }
  return result;
}
