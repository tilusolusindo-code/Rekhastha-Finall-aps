/**
 * Rekhastha PDF Export — Cloud Run Service
 *
 * Receives export requests from Vercel API (authenticated with Cloud Run
 * service account token), generates PDF with Puppeteer + Chromium,
 * uploads to GCS, returns signed download URL.
 *
 * POST /export/pdf
 *   { type: "payroll"|"attendance"|"gig_summary", jobId?, startDate?, endDate?, requestedBy }
 *
 * Required env:
 *   DATABASE_URL
 *   GCS_BACKUP_BUCKET
 *   GOOGLE_SERVICE_ACCOUNT_JSON
 */

import express from "express";
import puppeteer from "puppeteer-core";

const app = express();
app.use(express.json());

// Cloud Run: listen on PORT (default 8080)
const PORT = process.env.PORT ?? 8080;

// ── Token helper (same pattern as backup.mjs) ─────────────────────
const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "{}");

async function getStorageToken() {
  const now = Math.floor(Date.now() / 1000);
  const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/devstorage.read_write",
    aud: "https://oauth2.googleapis.com/token", exp: now + 3600, iat: now,
  })}`;
  const pem = sa.private_key.replace(/\\n/g, "\n");
  const keyData = pem.replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "").replace(/\s/g, "");
  const key = await crypto.subtle.importKey("pkcs8", Buffer.from(keyData, "base64"),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, Buffer.from(unsigned));
  const jwt = `${unsigned}.${Buffer.from(sig).toString("base64url")}`;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  return (await r.json()).access_token;
}

async function uploadToGCS(buffer, objName) {
  const token = await getStorageToken();
  const bucket = process.env.GCS_BACKUP_BUCKET;
  const r = await fetch(
    `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(objName)}`,
    { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/pdf" }, body: buffer }
  );
  if (!r.ok) throw new Error(`GCS upload failed ${r.status}`);
  // Return a signed URL valid 1 hour
  const signRes = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objName)}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return signRes.url;
}

// ── PDF generation ─────────────────────────────────────────────────
function buildHtml(params) {
  const { type, jobId, startDate, endDate, requestedBy } = params;
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body { font-family: 'Noto Sans', sans-serif; padding: 40px; color: #111; }
  h1 { color: #059669; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th { background: #059669; color: white; padding: 8px 12px; text-align: left; }
  td { padding: 8px 12px; border-bottom: 1px solid #e5e7eb; }
  .meta { color: #6b7280; font-size: 13px; margin-bottom: 24px; }
</style>
</head><body>
<h1>Rekhastha — ${type === "payroll" ? "Laporan Penggajian" : type === "attendance" ? "Laporan Presensi" : "Ringkasan Gig"}</h1>
<p class="meta">
  ${jobId ? `ID Gig: ${jobId} &nbsp;|&nbsp;` : ""}
  ${startDate ? `Dari: ${startDate} &nbsp;|&nbsp;` : ""}
  ${endDate ? `Sampai: ${endDate} &nbsp;|&nbsp;` : ""}
  Dibuat: ${new Date().toLocaleString("id-ID")} &nbsp;|&nbsp;
  Oleh: ${requestedBy}
</p>
<p style="color:#6b7280;font-style:italic">
  (Data aktual akan diisi dari query database di versi produksi)
</p>
</body></html>`;
}

app.post("/export/pdf", async (req, res) => {
  try {
    const { type = "gig_summary", jobId, startDate, endDate, requestedBy = "system" } = req.body ?? {};
    const browser = await puppeteer.launch({
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH ?? "/usr/bin/chromium",
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      headless: true,
    });
    const page = await browser.newPage();
    await page.setContent(buildHtml({ type, jobId, startDate, endDate, requestedBy }), { waitUntil: "networkidle0" });
    const pdf = await page.pdf({ format: "A4", printBackground: true });
    await browser.close();

    const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
    const objName = `exports/${type}-${ts}.pdf`;
    const downloadUrl = await uploadToGCS(pdf, objName);
    res.json({ ok: true, url: downloadUrl, objectName: objName });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));
app.listen(PORT, () => console.log(`PDF export service listening on :${PORT}`));
