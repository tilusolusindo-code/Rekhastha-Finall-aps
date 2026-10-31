import { randomUUID } from "node:crypto";

/**
 * Private object storage on Supabase Storage.
 *
 * Objects live in one PRIVATE bucket (default `rekhastha-private`, created by
 * supabase/migrations/0001_setup.sql). Nothing is ever public: the API checks
 * ownership first and then redirects to a short-lived signed URL, and browsers
 * upload application attachments straight to storage with a signed upload URL.
 *
 * The `/objects/<relative path>` addressing used throughout the API is kept, so
 * route code and database rows are unchanged.
 */

export interface PrivateUploadTarget {
  uploadUrl: string;
  objectPath: string;
}

function storageConfig(): { baseUrl: string; serviceKey: string; bucket: string } {
  const baseUrl = process.env["SUPABASE_URL"]?.trim().replace(/\/+$/, "");
  const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"]?.trim();
  if (!baseUrl || !serviceKey) {
    throw new Error("SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY belum dikonfigurasi.");
  }
  const bucket = process.env["SUPABASE_STORAGE_BUCKET"]?.trim() || "rekhastha-private";
  return { baseUrl, serviceKey, bucket };
}

/** `/objects/uploads/kyc/abc.jpg` -> `uploads/kyc/abc.jpg` (validated, encoded). */
function objectNameFor(objectPath: string): string {
  if (!objectPath.startsWith("/objects/")) {
    throw new Error("Path lampiran tidak valid.");
  }
  const relativePath = objectPath.slice("/objects/".length);
  const segments = relativePath.split("/");
  if (
    !relativePath ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("Path lampiran tidak valid.");
  }
  return segments.map(encodeURIComponent).join("/");
}

function authHeaders(serviceKey: string): Record<string, string> {
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
}

export async function uploadPrivateObject(
  objectPath: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const { baseUrl, serviceKey, bucket } = storageConfig();
  const objectName = objectNameFor(objectPath);
  const response = await fetch(`${baseUrl}/storage/v1/object/${bucket}/${objectName}`, {
    method: "POST",
    headers: {
      ...authHeaders(serviceKey),
      "Content-Type": contentType,
      "x-upsert": "false",
    },
    body: new Uint8Array(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Gagal menyimpan berkas (${response.status}).`);
  }
}

export async function createPrivateUploadTarget(): Promise<PrivateUploadTarget> {
  const { baseUrl, serviceKey, bucket } = storageConfig();
  const relativePath = `uploads/applications/${randomUUID()}`;
  const response = await fetch(
    `${baseUrl}/storage/v1/object/upload/sign/${bucket}/${objectNameFor(`/objects/${relativePath}`)}`,
    {
      method: "POST",
      headers: { ...authHeaders(serviceKey), "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) {
    throw new Error(`Gagal membuat URL unggah (${response.status}).`);
  }
  const result = (await response.json()) as { url?: unknown };
  if (typeof result.url !== "string") {
    throw new Error("URL unggah tidak tersedia.");
  }
  return {
    uploadUrl: `${baseUrl}/storage/v1${result.url.startsWith("/") ? "" : "/"}${result.url}`,
    objectPath: `/objects/${relativePath}`,
  };
}

export async function verifyPrivateObjectExists(
  objectPath: string,
  expectedSize?: number,
): Promise<boolean> {
  const { baseUrl, serviceKey, bucket } = storageConfig();
  const response = await fetch(
    `${baseUrl}/storage/v1/object/info/authenticated/${bucket}/${objectNameFor(objectPath)}`,
    {
      headers: authHeaders(serviceKey),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) return false;
  if (!expectedSize) return true;
  const info = (await response.json().catch(() => ({}))) as { size?: unknown };
  return typeof info.size !== "number" || info.size === expectedSize;
}

export async function createPrivateDownloadUrl(objectPath: string): Promise<string> {
  const { baseUrl, serviceKey, bucket } = storageConfig();
  const response = await fetch(
    `${baseUrl}/storage/v1/object/sign/${bucket}/${objectNameFor(objectPath)}`,
    {
      method: "POST",
      headers: { ...authHeaders(serviceKey), "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: 300 }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) {
    throw new Error(`Gagal membuat URL unduhan (${response.status}).`);
  }
  const result = (await response.json()) as { signedURL?: unknown };
  if (typeof result.signedURL !== "string") {
    throw new Error("URL unduhan tidak tersedia.");
  }
  return `${baseUrl}/storage/v1${result.signedURL.startsWith("/") ? "" : "/"}${result.signedURL}`;
}
