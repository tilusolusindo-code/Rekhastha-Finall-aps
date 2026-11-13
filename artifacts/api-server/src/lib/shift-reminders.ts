import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { notifyByEmail } from "./notify";
import { kvPutIfAbsent } from "./ephemeral";
import { logger } from "./logger";

type Row = {
  application_id: number;
  worker_id: string;
  posisi: string;
  jam_kerja: string | null;
  alamat: string | null;
  tomorrow: string;
};

/**
 * Kirim email pengingat H-1 kepada pekerja yang sudah diterima dan dijadwalkan bekerja besok
 * (menurut tanggal WIB). Lowongan berhari-hari mengingatkan setiap hari selama masa kerja.
 * Aman dijalankan berulang: satu email per lamaran per tanggal (dedupe lewat kvPutIfAbsent).
 * Mengembalikan jumlah email yang dikirim.
 */
export async function sendShiftReminders(now: Date = new Date()): Promise<number> {
  const rows = await db.execute<Row>(sql`
    SELECT a.id AS application_id, a.worker_id, g.posisi, g.jam_kerja, g.alamat,
           to_char(((${now.toISOString()}::timestamptz AT TIME ZONE 'Asia/Jakarta')::date + 1), 'YYYY-MM-DD') AS tomorrow
    FROM applications a
    JOIN gigs g ON g.id = a.job_id
    WHERE a.status = 'diterima'
      AND g.job_date IS NOT NULL
      AND g.payment_status = 'confirmed'
      AND COALESCE(g.escrow_status, '') NOT IN ('refunded', 'cancelled', 'pending_payment')
      AND ((${now.toISOString()}::timestamptz AT TIME ZONE 'Asia/Jakarta')::date + 1)
          BETWEEN (g.job_date AT TIME ZONE 'Asia/Jakarta')::date
              AND (g.job_date AT TIME ZONE 'Asia/Jakarta')::date + (GREATEST(COALESCE(g.jumlah_hari, 1), 1) - 1)
    LIMIT 1000
  `);

  let sent = 0;
  for (const r of rows.rows) {
    try {
      const fresh = await kvPutIfAbsent(`mail:reminder:${r.application_id}:${r.tomorrow}`, 1, 36 * 3_600_000);
      if (!fresh) continue;
      const dateLabel = new Date(`${r.tomorrow}T00:00:00+07:00`).toLocaleDateString("id-ID", {
        weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta",
      });
      const ok = await notifyByEmail(r.worker_id, {
        kind: "reminder",
        jobTitle: r.posisi,
        dateLabel,
        jamKerja: r.jam_kerja,
        alamat: r.alamat,
      });
      if (ok) sent += 1;
    } catch (err) {
      logger.error({ err, applicationId: r.application_id }, "[shift-reminders] gagal mengirim pengingat");
    }
  }
  if (sent > 0) logger.info({ sent }, "[shift-reminders] pengingat terkirim");
  return sent;
}
