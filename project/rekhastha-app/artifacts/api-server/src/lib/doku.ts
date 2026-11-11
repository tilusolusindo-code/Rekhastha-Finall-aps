/**
 * DOKU Payment Gateway — SNAP API
 * Docs: https://developers.doku.com/accept-payment/direct-api/snap
 *
 * Channel aktif di akun Rekhastha (BRN-0248-17937):
 *   Payment Link, VA Multiple Banks, VA BNI, BRI, BSI, BJB, BNC,
 *   CIMB, BTN, BSS, Bank Sampoerna, VA DOKU
 *
 * Env vars (set di Vercel):
 *   DOKU_CLIENT_ID       — Client ID dari DOKU dashboard
 *   DOKU_SECRET_KEY      — Secret Key dari DOKU dashboard
 *   DOKU_IS_PRODUCTION   — "true" untuk live, default sandbox
 *   APP_BASE_URL         — https://rekhastha.my.id
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { logger } from "./logger";

// ── Config ───────────────────────────────────────────────────────────────────

export function isDokuProduction(): boolean {
  return process.env["DOKU_IS_PRODUCTION"] === "true";
}

function getConfig() {
  const clientId  = process.env["DOKU_CLIENT_ID"];
  const secretKey = process.env["DOKU_SECRET_KEY"];
  if (!clientId || !secretKey) {
    throw new Error("DOKU_CLIENT_ID dan DOKU_SECRET_KEY wajib dikonfigurasi di Vercel env.");
  }
  const isProduction = isDokuProduction();
  const baseUrl = isProduction
    ? "https://api.doku.com"
    : "https://api-sandbox.doku.com";
  return { clientId, secretKey, baseUrl, isProduction };
}

// ── Signature helpers ─────────────────────────────────────────────────────────

function makeDigest(body: string): string {
  return "SHA-256=" + createHash("sha256").update(body, "utf8").digest("base64");
}

function makeSignature(opts: {
  clientId: string; secretKey: string; requestId: string;
  timestamp: string; requestTarget: string; digest: string;
}): string {
  const components = [
    `Client-Id:${opts.clientId}`,
    `Request-Id:${opts.requestId}`,
    `Request-Timestamp:${opts.timestamp}`,
    `Request-Target:${opts.requestTarget}`,
    `Digest:${opts.digest}`,
  ].join("\n");
  return createHmac("sha256", opts.secretKey).update(components, "utf8").digest("base64");
}

function makeTimestamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

async function dokuPost<T>(requestTarget: string, body: object): Promise<T> {
  const { clientId, secretKey, baseUrl } = getConfig();
  const requestId = crypto.randomUUID();
  const timestamp = makeTimestamp();
  const bodyStr   = JSON.stringify(body);
  const digest    = makeDigest(bodyStr);
  const signature = makeSignature({ clientId, secretKey, requestId, timestamp, requestTarget, digest });

  const res = await fetch(`${baseUrl}${requestTarget}`, {
    method: "POST",
    headers: {
      "Content-Type":    "application/json",
      "Client-Id":       clientId,
      "Request-Id":      requestId,
      "Request-Timestamp": timestamp,
      "Signature":       `HMACSHA256=${signature}`,
      "Digest":          digest,
    },
    body: bodyStr,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    logger.error({ status: res.status, body: errText, requestTarget }, "DOKU API error");
    throw new Error(`DOKU error ${res.status}: ${errText}`);
  }

  return (await res.json()) as T;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DokuCreateOrderParams {
  orderId:       string;   // invoice_number
  amount:        number;   // Rupiah
  customerName:  string;
  customerEmail: string;
  description?:  string;
  /**
   * Channel yang diinginkan. Kalau tidak diisi → semua channel aktif tampil
   * di halaman checkout DOKU (Payment Link default).
   * Contoh: "VIRTUAL_ACCOUNT_BNI" | "VIRTUAL_ACCOUNT_BRI" | "VIRTUAL_ACCOUNT_BSI"
   *         | "VIRTUAL_ACCOUNT_CIMB" | "VIRTUAL_ACCOUNT_BJB" | "VIRTUAL_ACCOUNT_BNC"
   *         | "VIRTUAL_ACCOUNT_BTN" | "VIRTUAL_ACCOUNT_BSS" | "VIRTUAL_ACCOUNT_DOKU"
   */
  channel?: string;
}

export interface DokuCreateOrderResult {
  checkoutUrl:   string;
  token:         string;
  requestId:     string;
  invoiceNumber: string;
}

export interface DokuNotifyPayload {
  order: { invoice_number: string; amount: number };
  transaction: { status: string; date: string; original_request_id: string };
  security: { check_hash: string };
  payment?: { channel: string; channel_id: string; virtual_account_number?: string };
}

// ── Payment Link (default — semua channel aktif tampil) ───────────────────────

export async function createDokuOrder(
  params: DokuCreateOrderParams
): Promise<DokuCreateOrderResult> {
  const appBase = process.env["APP_BASE_URL"] ?? "https://rekhastha.my.id";
  const { clientId } = getConfig();

  const body: Record<string, unknown> = {
    client:  { id: clientId },
    order: {
      invoice_number: params.orderId,
      line_items: [{
        name:     params.description ?? "Rekhastha Bisnis",
        price:    params.amount,
        quantity: 1,
      }],
      amount:               params.amount,
      currency:             "IDR",
      callback_url:         `${appBase}/api/doku/notify`,
      success_return_url:   `${appBase}/?payment=success&order=${params.orderId}`,
      failed_return_url:    `${appBase}/?payment=failed&order=${params.orderId}`,
    },
    payment: { payment_due_date: 60 },
    customer: { name: params.customerName, email: params.customerEmail },
  };

  // Kalau channel spesifik diminta (VA BNI, dll) → sertakan di payment_method
  if (params.channel) {
    (body.payment as Record<string, unknown>)["channel"] = params.channel;
  }

  const data = await dokuPost<{ payment: { url: string; token: string }; order: { invoice_number: string }; request_id?: string }>(
    "/checkout/v1/payment",
    body
  );

  return {
    checkoutUrl:   data.payment.url,
    token:         data.payment.token,
    requestId:     data.request_id ?? crypto.randomUUID(),
    invoiceNumber: data.order.invoice_number,
  };
}

// ── Webhook Verification ──────────────────────────────────────────────────────

/**
 * Verifikasi signature notifikasi DOKU:
 * check_hash = SHA-256( clientId + secretKey + invoiceNumber + amount + status )
 */
export function verifyDokuNotification(payload: DokuNotifyPayload): boolean {
  const { clientId, secretKey } = getConfig();
  const { invoice_number, amount } = payload.order;
  const { status } = payload.transaction;

  const raw      = `${clientId}${secretKey}${invoice_number}${amount}${status}`;
  const expected = createHash("sha256").update(raw, "utf8").digest("hex");
  const provided = payload.security.check_hash.trim().toLowerCase();

  const expBuf = Buffer.from(expected, "utf8");
  const prvBuf = Buffer.from(provided, "utf8");
  return expBuf.length === prvBuf.length && timingSafeEqual(expBuf, prvBuf);
}

export function logDokuMode(): void {
  logger.info(
    { isProduction: isDokuProduction(), mode: isDokuProduction() ? "LIVE" : "SANDBOX" },
    "DOKU Payment Gateway initialized"
  );
}

/** Channel VA yang tersedia — untuk ditampilkan di UI pilihan metode bayar */
export const DOKU_VA_CHANNELS = [
  { id: "VIRTUAL_ACCOUNT_BNI",       label: "Virtual Account BNI",   logo: "bni" },
  { id: "VIRTUAL_ACCOUNT_BRI",       label: "Virtual Account BRI",   logo: "bri" },
  { id: "VIRTUAL_ACCOUNT_BSI",       label: "Virtual Account BSI",   logo: "bsi" },
  { id: "VIRTUAL_ACCOUNT_CIMB",      label: "Virtual Account CIMB",  logo: "cimb" },
  { id: "VIRTUAL_ACCOUNT_BJB",       label: "Virtual Account BJB",   logo: "bjb" },
  { id: "VIRTUAL_ACCOUNT_BNC",       label: "Virtual Account BNC Neobank", logo: "bnc" },
  { id: "VIRTUAL_ACCOUNT_BTN",       label: "Virtual Account BTN",   logo: "btn" },
  { id: "VIRTUAL_ACCOUNT_BSS",       label: "Virtual Account Bank Sampoerna", logo: "bss" },
  { id: "VIRTUAL_ACCOUNT_DOKU",      label: "Virtual Account DOKU",  logo: "doku" },
  { id: "PAYMENT_LINK",              label: "Payment Link (semua metode)", logo: "doku" },
] as const;
