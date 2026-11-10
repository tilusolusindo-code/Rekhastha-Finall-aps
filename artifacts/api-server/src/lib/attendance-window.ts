/**
 * Jendela waktu presensi (anti-titip absen & presensi sembarang waktu).
 *
 * Jam kerja lowongan berupa teks bebas yang diketik pemberi kerja, mis.
 * "08:00 - 17:00 WIB". Bila tidak bisa dibaca, hanya tanggal yang diperiksa
 * (fail-open agar pekerja yang sah tidak terblokir karena format teks).
 *
 *  - Presensi MASUK : dari PRE_START_MIN menit sebelum jam mulai sampai jam selesai.
 *  - Presensi PULANG: dari jam mulai sampai POST_END_MIN menit setelah jam selesai.
 *  - Tanggal       : hari pertama = tanggal kerja, sepanjang `jumlahHari` hari.
 *  - Lowongan tanpa tanggal kerja (mis. mode instan) tidak dibatasi.
 *  - Shift lintas tengah malam (22:00 - 06:00) didukung.
 */

export const PRE_START_MIN = 60;
export const POST_END_MIN = 120;
const TZ = "Asia/Jakarta";

export interface Shift {
  startMin: number;
  /** Bisa > 1440 untuk shift yang melewati tengah malam. */
  endMin: number;
}

const SHIFT_RE = /(\d{1,2})\s*[:.]\s*(\d{2})\s*(?:-|–|—|s\/d|sd|sampai|hingga|to)\s*(\d{1,2})\s*[:.]\s*(\d{2})/i;

export function parseShift(jamKerja: string | null | undefined): Shift | null {
  if (!jamKerja) return null;
  const m = SHIFT_RE.exec(jamKerja);
  if (!m) return null;
  const [sh, sm, eh, em] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (sh > 23 || eh > 24 || sm > 59 || em > 59) return null;
  const startMin = sh * 60 + sm;
  let endMin = eh * 60 + em;
  if (endMin <= startMin) endMin += 1440;
  return { startMin, endMin };
}

const hhmm = (min: number): string => {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/** Tanggal "YYYY-MM-DD" dan menit-sejak-tengah-malam pada zona Asia/Jakarta. */
function jakartaParts(d: Date): { date: string; minutes: number } {
  const date = d.toLocaleDateString("sv-SE", { timeZone: TZ });
  const [h, m] = d.toLocaleTimeString("sv-SE", { timeZone: TZ, hour12: false }).split(":").map(Number);
  return { date, minutes: (h ?? 0) * 60 + (m ?? 0) };
}

const dayIndex = (dateStr: string): number => Math.floor(Date.parse(`${dateStr}T00:00:00Z`) / 86_400_000);

export type WindowResult = { ok: true } | { ok: false; error: string };

export function checkAttendanceWindow(opts: {
  kind: "masuk" | "pulang";
  now: Date;
  jobDate: Date | null | undefined;
  jumlahHari: number | null | undefined;
  jamKerja: string | null | undefined;
}): WindowResult {
  if (!opts.jobDate) return { ok: true };

  const now = jakartaParts(opts.now);
  const first = dayIndex(jakartaParts(opts.jobDate).date);
  const days = Math.max(1, Math.floor(opts.jumlahHari ?? 1));
  const last = first + days - 1;
  const shift = parseShift(opts.jamKerja);
  const today = dayIndex(now.date);

  if (!shift) {
    // Hanya periksa tanggal. Beri keleluasaan 1 hari setelah hari terakhir (lembur lewat tengah malam).
    if (today < first) return { ok: false, error: "Presensi belum dibuka: lowongan ini belum memasuki tanggal kerja." };
    if (today > last + 1) return { ok: false, error: "Presensi sudah ditutup: tanggal kerja lowongan ini sudah lewat." };
    return { ok: true };
  }

  const nowAbs = today * 1440 + now.minutes;
  const pre = opts.kind === "masuk" ? PRE_START_MIN : 0;
  const post = opts.kind === "pulang" ? POST_END_MIN : 0;

  let earliestOpen = Infinity;
  let latestClose = -Infinity;
  for (let d = first; d <= last; d++) {
    const open = d * 1440 + shift.startMin - pre;
    const close = d * 1440 + shift.endMin + post;
    if (nowAbs >= open && nowAbs <= close) return { ok: true };
    earliestOpen = Math.min(earliestOpen, open);
    latestClose = Math.max(latestClose, close);
  }

  if (nowAbs < earliestOpen) {
    const when = earliestOpen - today * 1440 < 1440
      ? `pukul ${hhmm(earliestOpen)} hari ini`
      : `pukul ${hhmm(earliestOpen)} pada tanggal kerja`;
    return {
      ok: false,
      error: opts.kind === "masuk"
        ? `Presensi masuk baru dibuka ${when} (${PRE_START_MIN} menit sebelum jam mulai).`
        : `Presensi pulang baru dibuka ${when}.`,
    };
  }
  if (nowAbs > latestClose) {
    return { ok: false, error: "Waktu presensi untuk lowongan ini sudah ditutup." };
  }
  return { ok: false, error: "Hari ini bukan hari kerja lowongan ini, atau di luar jam presensi." };
}
