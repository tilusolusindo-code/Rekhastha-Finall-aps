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

function getConfig() {
  const serverKey = process.env["MIDTRANS_SERVER_KEY"];
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

/**
 * Verifikasi signature notifikasi Midtrans:
 * SHA-512( order_id + status_code + gross_amount + server_key )
 */
export function verifyMidtransSignature(params: {
  orderId: string;
  statusCode: string;
  grossAmount: string;
  signatureKey: string;
}): boolean {
  const { serverKey } = getConfig();
  const raw = `${params.orderId}${params.statusCode}${params.grossAmount}${serverKey}`;
  const expected = createHash("sha512").update(raw, "utf8").digest("hex");

  const expBuf = Buffer.from(expected, "utf8");
  const prvBuf = Buffer.from(params.signatureKey.trim().toLowerCase(), "utf8");
  if (expBuf.length !== prvBuf.length) return false;
  return timingSafeEqual(expBuf, prvBuf);
}

export function logMidtransMode(): void {
  logger.info(
    { isProduction: isMidtransProduction(), mode: isMidtransProduction() ? "LIVE" : "SANDBOX" },
    "[midtrans] Payment Gateway initialized"
  );
}
