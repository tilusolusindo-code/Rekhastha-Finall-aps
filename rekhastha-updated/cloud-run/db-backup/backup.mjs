/**
 * Rekhastha DB Backup — Cloud Run Job
 *
 * Runs pg_dump against Supabase Postgres, gzips the output,
 * uploads to Google Cloud Storage, then exits.
 *
 * Scheduled nightly by Cloud Scheduler via Cloud Run Jobs.
 *
 * Required env:
 *   DATABASE_URL                  – Supabase session pooler connection string
 *   GCS_BACKUP_BUCKET             – target GCS bucket name
 *   GOOGLE_SERVICE_ACCOUNT_JSON   – SA JSON with Storage Object Creator role
 */

import { execSync } from "node:child_process";
import { createGzip } from "node:zlib";
import { Readable } from "node:stream";

const DATABASE_URL = process.env.DATABASE_URL;
const GCS_BUCKET   = process.env.GCS_BACKUP_BUCKET;
const SA_JSON      = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

if (!DATABASE_URL || !GCS_BUCKET || !SA_JSON) {
  console.error("Missing required environment variables");
  process.exit(1);
}

// ── JWT helper ────────────────────────────────────────────────────
const sa = JSON.parse(SA_JSON);

async function getStorageToken() {
  const now = Math.floor(Date.now() / 1000);
  const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const unsigned = `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/devstorage.read_write",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  })}`;
  const pem = sa.private_key.replace(/\\n/g, "\n");
  const keyData = pem.replace(/-----BEGIN PRIVATE KEY-----/, "")
                     .replace(/-----END PRIVATE KEY-----/, "")
                     .replace(/\s/g, "");
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8", Buffer.from(keyData, "base64"),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, Buffer.from(unsigned));
  const jwt = `${unsigned}.${Buffer.from(sig).toString("base64url")}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  return (await res.json()).access_token;
}

// ── Backup ────────────────────────────────────────────────────────
const now    = new Date();
const ts     = now.toISOString().slice(0, 19).replace(/[T:]/g, "-");
const objName = `rekhastha-backup-${ts}.sql.gz`;

console.log(`Starting backup → gs://${GCS_BUCKET}/${objName}`);

const dumpBuffer = execSync(
  `pg_dump "${DATABASE_URL}" --format=plain --no-password --clean --if-exists`,
  { maxBuffer: 500 * 1024 * 1024 }  // 500 MB
);

// Gzip in memory
const gzipped = await new Promise((resolve, reject) => {
  const chunks = [];
  const gz = createGzip({ level: 9 });
  Readable.from(dumpBuffer).pipe(gz)
    .on("data", c => chunks.push(c))
    .on("end", () => resolve(Buffer.concat(chunks)))
    .on("error", reject);
});

const token = await getStorageToken();
const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(GCS_BUCKET)}/o?uploadType=media&name=${encodeURIComponent(objName)}`;

const uploadRes = await fetch(uploadUrl, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/gzip" },
  body: gzipped,
});

if (!uploadRes.ok) {
  const body = await uploadRes.text().catch(() => "");
  console.error(`Upload failed ${uploadRes.status}: ${body}`);
  process.exit(1);
}

const mb = (gzipped.length / 1024 / 1024).toFixed(2);
console.log(`✓ Backup berhasil diunggah: ${objName} (${mb} MB)`);
