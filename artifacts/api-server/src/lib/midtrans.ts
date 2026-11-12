/**
 * Midtrans Snap API Client
 * Docs: https://docs.midtrans.com/reference/create-snap-token
 *
 * Env vars (set di Vercel Dashboard):
 *   MIDTRANS_SERVER_KEY    — Server Key dari dashboard Midtrans
 *   MIDTRANS_IS_PRODUCTION — "true" untuk production, default sandbox
 *
 * Frontend (VITE_ prefix — wajib ada di vite.config):
 *   VITE_MIDTRANS_CLIENT_KEY    — Client Key dari dashboard Midtrans
 *   VITE_MIDTRANS_IS_PRODUCTION — "true" untuk production
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { logger } from "./logger";

export function isMidtransProduction(): boolean {
  return process.env["MIDTRANS_IS_PRODUCTION"] === "true";
}

/** True bila Server Key terisi, sehingga pembayaran Midtrans bisa dipakai. */
export function isMidtransConfigured(): boolean {
  return Boolean(process.env["MIDTRANS_SERVER_KEY"]?.trim().replace(/^["']|["']$/g, ""));
}

function getConfig() {
  // Bersihkan spasi/baris baru dan tanda kutip yang sering ikut tersalin ke env.
  const serverKey = process.env["MIDTRANS_SERVER_KEY"]?.trim().replace(/^["']|["']$/g, "");
  if (!serverKey) throw new Error("MIDTRANS_SERVER_KEY belum dikonfigurasi di Vercel env.");
  const isProduction = isMidtransProduction();
  const baseUrl = isProduction
    ? "https://app.midtrans.com/snap/v1"
    : "https://app.sandbox.midtrans.com/snap/v1";
  return { serverKey, baseUrl, isProduction };
}

function basicAuth(serverKey: string): string {
  return "Basic " + Buffer.from(`${serverKey}:`).toString("base64");
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SnapTransactionParams {
  transaction_details: { order_id: string; gross_amount: number };
  item_details?: Array<{ id: string; price: number; quantity: number; name: string }>;
  customer_details?: { first_name?: string; email?: string; phone?: string };
  callbacks?: { finish?: string; error?: string; pending?: string };
  custom_field1?: string;
  custom_field2?: string;
  custom_field3?: string;
  credit_card?: { secure?: boolean };
  expiry?: { start_time?: string; duration: number; unit: "minute" | "hour" | "day" };
}

export interface SnapResponse {
  token: string;
  redirect_url: string;
}

// ── Create Snap Token ─────────────────────────────────────────────────────────

export async function createSnapTransaction(
  params: SnapTransactionParams
): Promise<SnapResponse> {
  const { serverKey, baseUrl } = getConfig();

  const body = {
    ...params,
    credit_card: params.credit_card ?? { secure: true },
    expiry: params.expiry ?? { duration: 24, unit: "hour" },
  };

  const res = await fetch(`${baseUrl}/transactions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": basicAuth(serverKey),
      "Accept": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    logger.error({ status: res.status, body: errText }, "[midtrans] createSnap error");
    throw new Error(`Midtrans error ${res.status}: ${errText}`);
  }

  const data = await res.json() as SnapResponse;
  if (!data.token) throw new Error("Midtrans tidak mengembalikan token.");

  return data;
}

// ── Verify Webhook Signature ──────────────────────────────────────────────────

function cleanKey(value: string | undefined): string {
  return (value ?? "").trim().replace(/^["']|["']$/g, "");
}

/**
 * Verifikasi signature notifikasi Midtrans:
 * SHA-512( order_id + status_code + gross_amount + KEY )
 *
 * KEY yang dicoba, berurutan:
 *   1. MIDTRANS_SIGNATURE_SECRET_KEY — "Signature Secret Key" di dashboard
 *      (Settings → Access Keys), terpisah dari Server Key.
 *   2. MIDTRANS_SERVER_KEY — Server Key (dipakai juga untuk membuat Snap token).
 * Notifikasi sah jika cocok dengan salah satunya.
 */
export function verifyMidtransSignature(params: {
  orderId: string;
  statusCode: string;
  grossAmount: string;
  signatureKey: string;
}): boolean {
  const candidates: Array<{ name: string; key: string }> = [
    { name: "MIDTRANS_SIGNATURE_SECRET_KEY", key: cleanKey(process.env["MIDTRANS_SIGNATURE_SECRET_KEY"]) },
    { name: "MIDTRANS_SERVER_KEY", key: cleanKey(process.env["MIDTRANS_SERVER_KEY"]) },
  ].filter((c) => c.key !== "");

  const provided = Buffer.from(String(params.signatureKey ?? "").trim().toLowerCase(), "utf8");

  for (const { key } of candidates) {
    const raw = `${params.orderId}${params.statusCode}${params.grossAmount}${key}`;
    const expected = Buffer.from(createHash("sha512").update(raw, "utf8").digest("hex"), "utf8");
    if (expected.length === provided.length && timingSafeEqual(expected, provided)) return true;
  }

  // Diagnosa tanpa membocorkan kunci: hanya nama variabel, awalan, dan panjangnya.
  logger.warn(
    {
      mode: isMidtransProduction() ? "LIVE" : "SANDBOX",
      keys: candidates.map((c) => ({ env: c.name, prefix: c.key.slice(0, 7), length: c.key.length })),
      signatureSecretConfigured: candidates.some((c) => c.name === "MIDTRANS_SIGNATURE_SECRET_KEY"),
    },
    "[midtrans] Diagnosa signature: tidak ada kunci yang cocok dengan notifikasi",
  );
  return false;
}

// ── Get Status API (verifikasi langsung ke Midtrans) ──────────────────────────

export interface MidtransStatusResult {
  order_id: string;
  status_code: string;
  transaction_status: string;
  fraud_status?: string;
  gross_amount: string;
}

export type MidtransStatusLookup =
  | { ok: true; data: MidtransStatusResult }
  | { ok: false; reason: "not_found" | "rejected" | "unreachable" };

/**
 * Tanyakan status transaksi langsung ke Midtrans memakai Server Key.
 * Dipakai sebagai verifikasi notifikasi bila signature tidak bisa dicocokkan:
 * jawabannya datang dari Midtrans sendiri, jadi isi notifikasi tidak perlu dipercaya.
 */
export async function getMidtransTransactionStatus(orderId: string): Promise<MidtransStatusLookup> {
  const serverKey = cleanKey(process.env["MIDTRANS_SERVER_KEY"]);
  if (!serverKey) return { ok: false, reason: "unreachable" };

  const base = isMidtransProduction() ? "https://api.midtrans.com" : "https://api.sandbox.midtrans.com";
  try {
    const res = await fetch(`${base}/v2/${encodeURIComponent(orderId)}/status`, {
      headers: { Accept: "application/json", Authorization: basicAuth(serverKey) },
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json().catch(() => null)) as Partial<MidtransStatusResult> | null;
    if (!data) return { ok: false, reason: "unreachable" };

    // Midtrans sering membalas HTTP 200 dengan status_code "404"/"401" di dalam body.
    const code = String(data.status_code ?? res.status);
    if (code === "404") return { ok: false, reason: "not_found" };
    if (!code.startsWith("2") || data.order_id !== orderId || !data.transaction_status) {
      return { ok: false, reason: "rejected" };
    }
    return { ok: true, data: data as MidtransStatusResult };
  } catch (err) {
    logger.error({ err }, "[midtrans] Get Status API gagal dihubungi");
    return { ok: false, reason: "unreachable" };
  }
}

export type MidtransCancelResult = "cancelled" | "nothing_to_cancel" | "failed";

/**
 * Batalkan transaksi yang masih pending di Midtrans (nomor VA / QRIS langsung mati).
 * - "nothing_to_cancel": belum ada transaksi (pembeli belum memilih metode) atau sudah final
 *   (lunas/kedaluwarsa), jadi tidak ada yang perlu dibatalkan.
 * - "failed": Midtrans tidak terjangkau / ditolak; pemanggil tetap lanjut (best effort).
 */
export async function cancelMidtransTransaction(orderId: string): Promise<MidtransCancelResult> {
  const serverKey = cleanKey(process.env["MIDTRANS_SERVER_KEY"]);
  if (!serverKey) return "failed";
  const base = isMidtransProduction() ? "https://api.midtrans.com" : "https://api.sandbox.midtrans.com";
  try {
    const res = await fetch(`${base}/v2/${encodeURIComponent(orderId)}/cancel`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: basicAuth(serverKey) },
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json().catch(() => null)) as { status_code?: string } | null;
    const code = String(data?.status_code ?? res.status);
    if (code === "200") return "cancelled";
    if (code === "404" || code === "412") return "nothing_to_cancel";
    logger.warn({ orderId, code }, "[midtrans] Cancel ditolak");
    return "failed";
  } catch (err) {
    logger.error({ err, orderId }, "[midtrans] Cancel API gagal dihubungi");
    return "failed";
  }
}

export function logMidtransMode(): void {
  logger.info(
    { isProduction: isMidtransProduction(), mode: isMidtransProduction() ? "LIVE" : "SANDBOX" },
    "[midtrans] Payment Gateway initialized"
  );
}
