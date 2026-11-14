import * as webpushNs from "web-push";
import { eq, inArray } from "drizzle-orm";
import { db, pushSubscriptionsTable } from "@workspace/db";
import { logger } from "./logger";

/**
 * Web Push (VAPID). Variabel yang dibutuhkan:
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY  — buat dengan `npx web-push generate-vapid-keys`
 *   VAPID_SUBJECT                        — mailto:admin@domain-anda (opsional)
 */
// Bundler ESM memberi ekspor bernama; Node/CJS memberi `default`. Dukung keduanya.
const webpush: typeof import("web-push") = (webpushNs as unknown as { default?: typeof import("web-push") }).default ?? (webpushNs as unknown as typeof import("web-push"));

export function pushConfigured(): boolean {
  return Boolean(process.env["VAPID_PUBLIC_KEY"]?.trim() && process.env["VAPID_PRIVATE_KEY"]?.trim());
}
export function vapidPublicKey(): string | null {
  return process.env["VAPID_PUBLIC_KEY"]?.trim() || null;
}

/**
 * Endpoint langganan berasal dari klien, jadi server hanya boleh menghubungi layanan push resmi
 * (cegah SSRF ke alamat internal).
 */
const PUSH_HOST_SUFFIXES = [
  "fcm.googleapis.com",
  "push.services.mozilla.com",
  "push.apple.com",
  "notify.windows.com",
];
export function isAllowedPushEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return false;
    const host = u.hostname.toLowerCase();
    return PUSH_HOST_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`));
  } catch {
    return false;
  }
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

let configured = false;
function configure(): boolean {
  if (!pushConfigured()) return false;
  if (!configured) {
    webpush.setVapidDetails(
      process.env["VAPID_SUBJECT"]?.trim() || "mailto:admin@rekhastha.my.id",
      process.env["VAPID_PUBLIC_KEY"]!.trim(),
      process.env["VAPID_PRIVATE_KEY"]!.trim(),
    );
    configured = true;
  }
  return true;
}

/** Kirim ke semua perangkat milik user. Langganan yang sudah mati (404/410) dihapus. Tidak pernah melempar galat. */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<number> {
  try {
    if (!configure()) return 0;
    const subs = await db.select().from(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.userId, userId));
    if (subs.length === 0) return 0;
    const body = JSON.stringify({
      title: payload.title.slice(0, 120),
      body: payload.body.slice(0, 240),
      url: payload.url ?? "/",
      tag: payload.tag,
    });
    const dead: number[] = [];
    let sent = 0;
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            body,
            { TTL: 60 * 60 * 24, timeout: 10_000 },
          );
          sent += 1;
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) dead.push(s.id);
          else logger.warn({ status }, "[push] gagal mengirim");
        }
      }),
    );
    if (dead.length) await db.delete(pushSubscriptionsTable).where(inArray(pushSubscriptionsTable.id, dead));
    return sent;
  } catch (err) {
    logger.error({ err }, "[push] galat tak terduga");
    return 0;
  }
}
