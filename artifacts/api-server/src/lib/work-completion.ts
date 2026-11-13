import { and, eq, isNull, sql } from "drizzle-orm";
import { applicationsTable, attendanceTable, db, gigsTable } from "@workspace/db";

/**
 * Tandai pekerjaan SELESAI untuk satu pekerja bila semua hari kerjanya lengkap.
 *
 * Satu hari dihitung lengkap bila ada scan "masuk" DAN "pulang" pada tanggal yang sama.
 * Jumlah hari yang dibutuhkan = gigs.jumlah_hari (minimal 1). Hanya mengisi `work_completed_at`;
 * status lamaran tetap "diterima" sampai upah disetujui, jadi alur pencairan upah tidak berubah.
 *
 * Idempoten: aman dipanggil berulang. Mengembalikan true bila lamaran sekarang berstatus kerja-selesai.
 */
export async function markWorkCompletedIfDone(jobId: number, workerId: string): Promise<boolean> {
  const [gig] = await db.select({ jumlahHari: gigsTable.jumlahHari }).from(gigsTable).where(eq(gigsTable.id, jobId)).limit(1);
  if (!gig) return false;
  const required = Math.max(1, gig.jumlahHari ?? 1);

  const result = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM (
      SELECT scan_date FROM attendance
      WHERE job_id = ${jobId} AND worker_id = ${workerId}
      GROUP BY scan_date
      HAVING bool_or(kind = 'masuk') AND bool_or(kind = 'pulang')
    ) d`);
  const fullDays = Number(result.rows[0]?.n ?? 0);
  if (fullDays < required) return false;

  await db
    .update(applicationsTable)
    .set({ workCompletedAt: new Date() })
    .where(
      and(
        eq(applicationsTable.jobId, jobId),
        eq(applicationsTable.workerId, workerId),
        eq(applicationsTable.status, "diterima"),
        isNull(applicationsTable.workCompletedAt),
      ),
    );
  return true;
}
