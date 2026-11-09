/**
 * Google Cloud Storage helper — used by the Cloud Run backup job to upload
 * pg_dump output. Also exposes a list endpoint so the admin panel can show
 * available backups.
 *
 * This file runs ONLY inside Cloud Run (not on Vercel serverless).
 * On Vercel, import only `listBackups` (read-only, no upload).
 */

import { logger } from "./logger";

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  project_id: string;
}

function getServiceAccount(): ServiceAccountKey {
  const raw = process.env["GOOGLE_SERVICE_ACCOUNT_JSON"];
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON not set");
  return JSON.parse(raw) as ServiceAccountKey;
}

async function getStorageToken(sa: ServiceAccountKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const b64url = (obj: unknown): string =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  const unsigned = `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/devstorage.read_write",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  })}`;
  const pem = sa.private_key.replace(/\\n/g, "\n");
  const keyData = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
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
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Token request failed: ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

const bucket = (): string => {
  const b = process.env["GCS_BACKUP_BUCKET"];
  if (!b) throw new Error("GCS_BACKUP_BUCKET not set");
  return b;
};

/** Upload a Buffer to GCS. Returns the object name. */
export async function uploadBackup(data: Buffer, objectName: string): Promise<string> {
  const sa = getServiceAccount();
  const token = await getStorageToken(sa);
  const b = bucket();
  const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(b)}/o?uploadType=media&name=${encodeURIComponent(objectName)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/gzip" },
    body: data,
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GCS upload failed ${res.status}: ${body}`);
  }
  logger.info({ objectName, bucket: b, bytes: data.length }, "Backup uploaded to GCS");
  return objectName;
}

/** List the last N backup objects (sorted newest first). */
export async function listBackups(maxResults = 20): Promise<Array<{ name: string; size: string; updated: string }>> {
  const sa = getServiceAccount();
  const token = await getStorageToken(sa);
  const b = bucket();
  const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(b)}/o?maxResults=${maxResults}&prefix=rekhastha-backup-`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    logger.error({ status: res.status }, "GCS list failed");
    return [];
  }
  type GCSItem = { name: string; size: string; updated: string };
  const data = (await res.json()) as { items?: GCSItem[] };
  return (data.items ?? [])
    .sort((a, b) => b.updated.localeCompare(a.updated))
    .slice(0, maxResults)
    .map(({ name, size, updated }) => ({ name, size, updated }));
}
