import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { appBaseUrl, escapeHtml, mailerConfigured, sendEmail } from "./mailer";
import { kvPutIfAbsent } from "./ephemeral";
import { keepAlive } from "./vercel-context";
import { logger } from "./logger";
import { pushConfigured, sendPushToUser, type PushPayload } from "./web-push";

/**
 * Jenis notifikasi email dan kunci pengaturannya di users.notification_prefs.
 * Kunci yang tidak ada dianggap AKTIF; pengguna bisa mematikan per jenis.
 */
export const NOTIFICATION_KINDS = ["applicant", "status", "payment", "payout", "invite", "reminder"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];
export type NotificationPrefs = Partial<Record<NotificationKind, boolean>>;

export function sanitizePrefs(input: unknown): NotificationPrefs {
  const out: NotificationPrefs = {};
  if (typeof input !== "object" || input === null) return out;
  for (const kind of NOTIFICATION_KINDS) {
    const value = (input as Record<string, unknown>)[kind];
    if (typeof value === "boolean") out[kind] = value;
  }
  return out;
}

export type NotifyEvent =
  | { kind: "applicant"; applicantName: string; jobTitle: string; jobId: number }
  | { kind: "status"; status: "diterima" | "ditolak"; jobTitle: string }
  | { kind: "payment"; title: string; detail: string }
  | { kind: "payout"; jobTitle: string; amount: number }
  | { kind: "invite"; employerName: string; jobTitle: string }
  | { kind: "reminder"; jobTitle: string; dateLabel: string; jamKerja: string | null; alamat: string | null };

const rupiah = (n: number): string =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

function layout(name: string, bodyHtml: string, cta?: { label: string; href: string }): string {
  const button = cta
    ? `<p style="margin:20px 0"><a href="${cta.href}" style="display:inline-block;padding:12px 24px;background:#059669;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold">${escapeHtml(cta.label)}</a></p>`
    : "";
  return (
    `<div style="font-family:sans-serif;max-width:480px;margin:auto">` +
    `<h2 style="color:#059669">Rekhastha</h2>` +
    `<p>Halo ${escapeHtml(name || "Pengguna")},</p>${bodyHtml}${button}` +
    `<p style="color:#6b7280;font-size:12px;margin-top:24px">Anda bisa mematikan jenis email ini kapan saja di Profil → Edit Profil → Notifikasi email.</p>` +
    `</div>`
  );
}

function compose(name: string, event: NotifyEvent, base: string): { subject: string; html: string; text: string } {
  const e = escapeHtml;
  switch (event.kind) {
    case "applicant":
      return {
        subject: `Pelamar baru untuk ${event.jobTitle}`,
        html: layout(name, `<p><strong>${e(event.applicantName || "Seorang pekerja")}</strong> baru saja melamar lowongan <strong>${e(event.jobTitle)}</strong>.</p>`, { label: "Lihat pelamar", href: base }),
        text: `${event.applicantName || "Seorang pekerja"} baru saja melamar lowongan "${event.jobTitle}". Buka: ${base}`,
      };
    case "status": {
      const ok = event.status === "diterima";
      return {
        subject: `Lamaran Anda ${ok ? "diterima" : "ditolak"} — ${event.jobTitle}`,
        html: layout(
          name,
          `<p>Lamaran Anda untuk <strong>${e(event.jobTitle)}</strong> telah <strong>${ok ? "✅ diterima" : "❌ ditolak"}</strong>.</p>${ok ? "<p>Buka aplikasi untuk melihat jadwal dan presensi.</p>" : "<p>Jangan menyerah, masih banyak lowongan lain.</p>"}`,
          { label: "Buka Rekhastha", href: base },
        ),
        text: `Lamaran Anda untuk "${event.jobTitle}" ${ok ? "diterima" : "ditolak"}. Buka: ${base}`,
      };
    }
    case "payment":
      return {
        subject: event.title,
        html: layout(name, `<p>${e(event.detail)}</p>`, { label: "Buka Rekhastha", href: base }),
        text: `${event.detail}\n\nBuka: ${base}`,
      };
    case "payout":
      return {
        subject: `Upah masuk ${rupiah(event.amount)} — ${event.jobTitle}`,
        html: layout(name, `<p>Upah untuk pekerjaan <strong>${e(event.jobTitle)}</strong> sebesar <strong style="color:#059669">${rupiah(event.amount)}</strong> sudah masuk ke dompet Anda.</p>`, { label: "Lihat dompet", href: base }),
        text: `Upah untuk "${event.jobTitle}" sebesar ${rupiah(event.amount)} sudah masuk ke dompet Anda. Buka: ${base}`,
      };
    case "reminder": {
      const details = [event.jamKerja ? `Jam: ${event.jamKerja}` : "", event.alamat ? `Lokasi: ${event.alamat}` : ""].filter(Boolean);
      return {
        subject: `Pengingat: besok Anda bekerja — ${event.jobTitle}`,
        html: layout(
          name,
          `<p>Pengingat: besok (<strong>${e(event.dateLabel)}</strong>) Anda dijadwalkan bekerja di <strong>${e(event.jobTitle)}</strong>.</p>` +
            (details.length ? `<p>${details.map((d) => e(d)).join("<br>")}</p>` : "") +
            `<p>Siapkan diri dan lakukan presensi saat tiba di lokasi.</p>`,
          { label: "Buka Rekhastha", href: base },
        ),
        text: `Pengingat: besok (${event.dateLabel}) Anda bekerja di "${event.jobTitle}".${details.length ? `\n${details.join("\n")}` : ""}\nBuka: ${base}`,
      };
    }
    case "invite":
      return {
        subject: `${event.employerName} mengajak Anda bekerja lagi — ${event.jobTitle}`,
        html: layout(name, `<p><strong>${e(event.employerName)}</strong> mengajak Anda untuk lowongan <strong>${e(event.jobTitle)}</strong>. Buka aplikasi untuk melihat detail dan melamar.</p>`, { label: "Lihat lowongan", href: base }),
        text: `${event.employerName} mengajak Anda untuk lowongan "${event.jobTitle}". Buka: ${base}`,
      };
  }
}

/** Ringkasan singkat untuk notifikasi push (judul + isi satu kalimat). */
function composePush(event: NotifyEvent): PushPayload {
  switch (event.kind) {
    case "applicant":
      return { title: "Pelamar baru", body: `${event.applicantName || "Seorang pekerja"} melamar ${event.jobTitle}`, tag: `applicant-${event.jobId}` };
    case "status":
      return { title: event.status === "diterima" ? "Lamaran diterima" : "Lamaran ditolak", body: event.jobTitle, tag: "status" };
    case "payment":
      return { title: event.title, body: event.detail, tag: "payment" };
    case "payout":
      return { title: `Upah masuk ${rupiah(event.amount)}`, body: event.jobTitle, tag: "payout" };
    case "invite":
      return { title: `${event.employerName} mengajak Anda bekerja`, body: event.jobTitle, tag: "invite" };
    case "reminder":
      return { title: "Besok Anda bekerja", body: `${event.jobTitle} — ${event.dateLabel}`, tag: "reminder" };
  }
}

/** Push dikirim bila perangkat berlangganan dan pengguna tidak mematikan jenis notifikasi ini. */
async function deliverPush(userId: string, event: NotifyEvent): Promise<void> {
  try {
    if (!pushConfigured()) return;
    const [user] = await db
      .select({ suspended: usersTable.suspended, prefs: usersTable.notificationPrefs })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    if (!user || user.suspended) return;
    if (sanitizePrefs(user.prefs)[event.kind] === false) return;
    if (await throttled(userId, event, "push")) return;
    await sendPushToUser(userId, composePush(event));
  } catch (err) {
    logger.error({ err, kind: event.kind }, "[notify] gagal mengirim push");
  }
}

/** Pembatas: maksimal satu email "pelamar baru" per pemberi kerja per lowongan tiap 10 menit. */
async function throttled(userId: string, event: NotifyEvent, channel: "mail" | "push"): Promise<boolean> {
  if (event.kind !== "applicant") return false;
  const fresh = await kvPutIfAbsent(`${channel}:applicant:${userId}:${event.jobId}`, 1, 10 * 60 * 1000);
  return !fresh;
}

async function deliver(userId: string, event: NotifyEvent): Promise<boolean> {
  try {
    if (!mailerConfigured()) return false;
    const [user] = await db
      .select({
        email: usersTable.email,
        name: usersTable.name,
        suspended: usersTable.suspended,
        prefs: usersTable.notificationPrefs,
      })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    if (!user || user.suspended || !user.email) return false;
    if (sanitizePrefs(user.prefs)[event.kind] === false) return false;
    if (await throttled(userId, event, "mail")) return false;
    const base = appBaseUrl() ?? "https://rekhastha.my.id";
    const mail = compose(user.name, event, base);
    return await sendEmail({ to: user.email, ...mail });
  } catch (err) {
    logger.error({ err, kind: event.kind }, "[notify] gagal mengirim email notifikasi");
    return false;
  }
}

/**
 * Kirim email notifikasi tanpa memblokir respons. Tidak pernah melempar galat.
 * Mengembalikan promise agar bisa ditunggu di tes.
 */
export function notifyByEmail(userId: string, event: NotifyEvent): Promise<boolean> {
  // Email dan push berjalan sendiri-sendiri: gagal/tidak terpasangnya salah satu tidak mengganggu yang lain.
  // Pembatas "pelamar baru" dipisah per kanal (mail/push) supaya tidak saling mengambil jatah.
  const promise = deliver(userId, event);
  keepAlive(promise);
  keepAlive(deliverPush(userId, event));
  return promise;
}
