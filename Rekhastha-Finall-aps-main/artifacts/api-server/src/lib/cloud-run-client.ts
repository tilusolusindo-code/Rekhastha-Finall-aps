/**
 * Cloud Run task dispatcher — called from Vercel API routes to offload
 * long-running work (PDF export, DB reconciliation, KYC processing).
 *
 * Authentication: Cloud Run services are secured with `--no-allow-unauthenticated`.
 * We use a service account JWT (same pattern as gmail.ts) with the
 * "cloud-run-invoker" scope to get a token, then pass it as Bearer.
 *
 * Required env:
 *   GOOGLE_SERVICE_ACCOUNT_JSON   – same SA key as mailer (must have Cloud Run Invoker role)
 *   CLOUD_RUN_PDF_URL             – https://pdf-export-xxxxx-as.a.run.app
 *   CLOUD_RUN_RECONCILE_URL       – https://reconcile-xxxxx-as.a.run.app
 */

import { logger } from "./logger";

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

async function getCloudRunToken(sa: ServiceAccountKey, audience: string): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  const b64url = (obj: unknown): string =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  const unsigned = `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url({
    iss: sa.client_email,
    sub: sa.client_email,
    aud: audience,                         // audience = Cloud Run URL
    target_audience: audience,
    exp: now + 3600,
    iat: now,
  })}`;
  const pem = sa.private_key.replace(/\\n/g, "\n");
  const keyData = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  try {
    const cryptoKey = await crypto.subtle.importKey(
      "pkcs8",
      Buffer.from(keyData, "base64"),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, Buffer.from(unsigned));
    const jwt = `${unsigned}.${Buffer.from(sig).toString("base64url")}`;
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return ((await res.json()) as { id_token?: string }).id_token ?? null;
  } catch (err) {
    logger.error({ err }, "Cloud Run token error");
    return null;
  }
}

function getServiceAccount(): ServiceAccountKey | null {
  const raw = process.env["GOOGLE_SERVICE_ACCOUNT_JSON"];
  if (!raw) return null;
  try { return JSON.parse(raw) as ServiceAccountKey; } catch { return null; }
}

export interface CloudRunResult {
  ok: boolean;
  status?: number;
  data?: unknown;
  error?: string;
}

/** Generic Cloud Run task dispatcher. */
export async function invokeCloudRun(
  serviceUrl: string,
  path: string,
  body: unknown,
  timeoutMs = 55_000,
): Promise<CloudRunResult> {
  const sa = getServiceAccount();
  if (!sa || !serviceUrl) return { ok: false, error: "Cloud Run not configured" };

  const token = await getCloudRunToken(sa, serviceUrl);
  if (!token) return { ok: false, error: "Failed to get Cloud Run token" };

  try {
    const res = await fetch(`${serviceUrl}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    logger.error({ err, serviceUrl, path }, "Cloud Run invocation failed");
    return { ok: false, error: String(err) };
  }
}

/** Trigger PDF export job. Returns signed GCS URL for download. */
export async function triggerPdfExport(params: {
  type: "payroll" | "attendance" | "gig_summary";
  jobId?: number;
  startDate?: string;
  endDate?: string;
  requestedBy: string;
}): Promise<CloudRunResult> {
  const url = process.env["CLOUD_RUN_PDF_URL"];
  if (!url) return { ok: false, error: "CLOUD_RUN_PDF_URL not configured" };
  return invokeCloudRun(url, "/export/pdf", params, 55_000);
}

/** Trigger payment reconciliation. */
export async function triggerReconciliation(params: {
  provider: "midtrans" | "xendit";
  dateFrom: string;
  dateTo: string;
}): Promise<CloudRunResult> {
  const url = process.env["CLOUD_RUN_RECONCILE_URL"];
  if (!url) return { ok: false, error: "CLOUD_RUN_RECONCILE_URL not configured" };
  return invokeCloudRun(url, "/reconcile", params, 55_000);
}
