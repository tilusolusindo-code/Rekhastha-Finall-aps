import { logger } from "./logger";

/**
 * Gmail API transactional email sender using a Google Service Account.
 *
 * Uses Service Account + domain-wide delegation OR direct Gmail send
 * (the service account must have "Send email as" permission on the sender
 * Gmail address, OR you enable domain-wide delegation in Google Workspace).
 *
 * Without a Google Workspace domain (current situation), the sender address
 * must be the service account's associated Gmail, OR you can use the
 * "users.messages.send" endpoint impersonating a Gmail account that has
 * granted the service account access via OAuth.
 *
 * For Rekhastha without a domain yet: we fall back to the Gmail API's
 * "send from any address" flow using the service account's own email.
 *
 * Required env:
 *   GOOGLE_SERVICE_ACCOUNT_JSON  – full JSON key (one line, JSON.stringify'd)
 *   GMAIL_SENDER_ADDRESS         – the Gmail address to send from (must match SA or delegated)
 *   APP_BASE_URL                 – e.g. https://rekhastha-finall-aps.vercel.app
 */

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  project_id: string;
}

function getServiceAccount(): ServiceAccountKey | null {
  const raw = process.env["GOOGLE_SERVICE_ACCOUNT_JSON"];
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ServiceAccountKey;
  } catch {
    logger.error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON");
    return null;
  }
}

export function gmailConfigured(): boolean {
  return Boolean(
    process.env["GOOGLE_SERVICE_ACCOUNT_JSON"] &&
    process.env["GMAIL_SENDER_ADDRESS"],
  );
}

/** Mint a short-lived Google OAuth2 access token from a service account key. */
async function getAccessToken(sa: ServiceAccountKey, scope: string): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: sa.client_email,
    scope,
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const b64url = (obj: unknown): string =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");

  const unsigned = `${b64url(header)}.${b64url(payload)}`;

  // Sign with RS256 using the Web Crypto API (available on Node 18+, Vercel edge)
  const privateKeyPem = sa.private_key.replace(/\\n/g, "\n");
  try {
    const keyData = privateKeyPem
      .replace(/-----BEGIN PRIVATE KEY-----/, "")
      .replace(/-----END PRIVATE KEY-----/, "")
      .replace(/\s/g, "");
    const binaryKey = Buffer.from(keyData, "base64");
    const cryptoKey = await crypto.subtle.importKey(
      "pkcs8",
      binaryKey,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, Buffer.from(unsigned));
    const jwt = `${unsigned}.${Buffer.from(sig).toString("base64url")}`;

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!tokenRes.ok) {
      logger.error({ status: tokenRes.status }, "Failed to get Google access token");
      return null;
    }
    const data = (await tokenRes.json()) as { access_token?: string };
    return data.access_token ?? null;
  } catch (err) {
    logger.error({ err }, "Error signing Google JWT");
    return null;
  }
}

/** Build RFC 2822 email message, base64url encoded for Gmail API. */
function buildRawMessage(params: {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}): string {
  const boundary = `rekhastha_${Date.now().toString(36)}`;
  // Nilai header tidak boleh memuat CR/LF: nama pengguna/judul lowongan bisa diisi penyerang.
  const header = (v: string): string => v.replace(/[\r\n\u0000]+/g, " ").trim();
  const message = [
    `From: ${header(params.from)}`,
    `To: ${header(params.to)}`,
    `Subject: ${header(params.subject)}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset=UTF-8`,
    ``,
    params.text,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    ``,
    params.html,
    ``,
    `--${boundary}--`,
  ].join("\r\n");

  return Buffer.from(message).toString("base64url");
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch,
  );
}

export function appBaseUrl(): string | null {
  const raw = process.env["APP_BASE_URL"]?.trim().replace(/\/+$/, "");
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.hostname === "localhost" ? url.origin : null;
  } catch {
    return null;
  }
}

async function sendViaGmailApiOnly(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<boolean> {
  const sa = getServiceAccount();
  const sender = process.env["GMAIL_SENDER_ADDRESS"];
  if (!sa || !sender) return false;

  const token = await getAccessToken(sa, "https://www.googleapis.com/auth/gmail.send");
  if (!token) return false;

  const raw = buildRawMessage({
    from: `Rekhastha <${sender}>`,
    to: params.to,
    subject: params.subject,
    html: params.html,
    text: params.text,
  });

  try {
    // userId "me" = the service account's delegated sender / the authenticated user
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.error({ status: res.status, body }, "Gmail API rejected email");
      return false;
    }
    return true;
  } catch (err) {
    logger.error({ err }, "Gmail API send failed");
    return false;
  }
}

async function sendViaResend(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<boolean> {
  const key = process.env["RESEND_API_KEY"];
  const from = process.env["MAIL_FROM"];
  if (!key || !from) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [params.to], subject: params.subject, html: params.html, text: params.text }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.error({ status: res.status, body }, "Resend rejected email");
      return false;
    }
    return true;
  } catch (err) {
    logger.error({ err }, "Resend send failed");
    return false;
  }
}

/** Kirim email: Gmail API lebih dulu, lalu Resend sebagai cadangan bila Gmail tidak terpasang atau gagal. */
export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<boolean> {
  if (gmailConfigured() && (await sendViaGmailApiOnly(params))) return true;
  return sendViaResend(params);
}

// ── Public helpers ────────────────────────────────────────────────

export async function sendPasswordResetEmail(
  to: string,
  name: string,
  token: string,
): Promise<boolean> {
  const base = appBaseUrl();
  if (!base) {
    logger.error("APP_BASE_URL not configured — cannot build reset link");
    return false;
  }
  const link = `${base}/?reset_token=${encodeURIComponent(token)}`;
  const safeName = escapeHtml(name || "Pengguna");

  return sendEmail({
    to,
    subject: "Reset kata sandi Rekhastha",
    html:
      `<div style="font-family:sans-serif;max-width:480px;margin:auto">` +
      `<h2 style="color:#059669">Rekhastha</h2>` +
      `<p>Halo ${safeName},</p>` +
      `<p>Kami menerima permintaan reset kata sandi. Klik tautan berikut (berlaku 15 menit):</p>` +
      `<a href="${link}" style="display:inline-block;padding:12px 24px;background:#059669;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold">Buat Kata Sandi Baru</a>` +
      `<p style="margin-top:24px;color:#6b7280;font-size:13px">Jika Anda tidak meminta ini, abaikan email ini.</p>` +
      `</div>`,
    text:
      `Halo ${name || "Pengguna"},\n\nBuka tautan ini dalam 15 menit:\n${link}\n\n` +
      `Jika Anda tidak meminta ini, abaikan email ini.\n\n— Tim Rekhastha`,
  });
}

export async function sendWelcomeEmail(to: string, name: string): Promise<boolean> {
  const base = appBaseUrl() ?? "https://rekhastha.my.id";
  const safeName = escapeHtml(name || "Pengguna");
  return sendEmail({
    to,
    subject: "Selamat datang di Rekhastha!",
    html:
      `<div style="font-family:sans-serif;max-width:480px;margin:auto">` +
      `<h2 style="color:#059669">Rekhastha</h2>` +
      `<p>Halo ${safeName}, selamat datang! 🎉</p>` +
      `<p>Akun Anda sudah aktif. Mulai cari pekerjaan harian atau pasang lowongan sekarang.</p>` +
      `<a href="${base}" style="display:inline-block;padding:12px 24px;background:#059669;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold">Buka Rekhastha</a>` +
      `</div>`,
    text: `Halo ${name || "Pengguna"}, selamat datang di Rekhastha!\n\nAkun Anda sudah aktif. Buka: ${base}`,
  });
}

export async function sendApplicationStatusEmail(params: {
  to: string;
  workerName: string;
  gigTitle: string;
  status: "diterima" | "ditolak";
}): Promise<boolean> {
  const base = appBaseUrl() ?? "https://rekhastha.my.id";
  const { to, workerName, gigTitle, status } = params;
  const safe = (s: string): string => escapeHtml(s);
  const accepted = status === "diterima";
  return sendEmail({
    to,
    subject: `Lamaran Anda ${accepted ? "diterima" : "ditolak"} — ${gigTitle}`,
    html:
      `<div style="font-family:sans-serif;max-width:480px;margin:auto">` +
      `<h2 style="color:#059669">Rekhastha</h2>` +
      `<p>Halo ${safe(workerName)},</p>` +
      `<p>Lamaran Anda untuk <strong>${safe(gigTitle)}</strong> telah <strong>${accepted ? "✅ diterima" : "❌ ditolak"}</strong>.</p>` +
      `${accepted ? `<p>Silakan buka aplikasi untuk detail jadwal dan presensi.</p><a href="${base}" style="display:inline-block;padding:12px 24px;background:#059669;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold">Buka Rekhastha</a>` : ""}` +
      `</div>`,
    text:
      `Halo ${workerName},\n\nLamaran Anda untuk "${gigTitle}" ${accepted ? "diterima ✅" : "ditolak ❌"}.\n` +
      `${accepted ? `\nBuka: ${base}` : ""}`,
  });
}

export async function sendPayoutNotificationEmail(params: {
  to: string;
  workerName: string;
  gigTitle: string;
  amount: number;
  dayIndex: number;
}): Promise<boolean> {
  const { to, workerName, gigTitle, amount, dayIndex } = params;
  const safe = (s: string): string => escapeHtml(s);
  const formatted = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(amount);
  return sendEmail({
    to,
    subject: `Pembayaran hari ke-${dayIndex} sudah masuk — ${gigTitle}`,
    html:
      `<div style="font-family:sans-serif;max-width:480px;margin:auto">` +
      `<h2 style="color:#059669">Rekhastha</h2>` +
      `<p>Halo ${safe(workerName)},</p>` +
      `<p>Upah harian ke-<strong>${dayIndex}</strong> untuk pekerjaan <strong>${safe(gigTitle)}</strong> sebesar <strong style="color:#059669">${formatted}</strong> sudah masuk ke dompet Anda.</p>` +
      `</div>`,
    text:
      `Halo ${workerName},\n\nUpah harian ke-${dayIndex} untuk "${gigTitle}" sebesar ${formatted} sudah masuk ke dompet Anda.`,
  });
}
export async function sendTeamInvitationEmail(params: {
  to: string;
  companyName: string;
  role: "hr" | "supervisor";
  link: string;
}): Promise<boolean> {
  const roleLabel: Record<string, string> = {
    hr: "HR / Rekrutmen",
    supervisor: "Supervisor Lapangan",
  };
  const { to, companyName, role, link } = params;
  const label = roleLabel[role] ?? role;
  const esc = (s: string) => s.replace(/[&<>"']/g, c =>
    ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" })[c] ?? c);
  return sendEmail({
    to,
    subject: `${companyName} mengundang Anda bergabung ke tim Rekhastha`,
    html:
      `<div style="font-family:sans-serif;max-width:480px;margin:auto">` +
      `<h2 style="color:#059669">Rekhastha</h2>` +
      `<p>Anda diundang oleh <b>${esc(companyName)}</b> untuk bergabung sebagai <b>${esc(label)}</b> di platform Rekhastha.</p>` +
      `<p style="margin:20px 0"><a href="${link}" style="display:inline-block;padding:12px 24px;background:#059669;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold">Terima Undangan</a></p>` +
      `<p style="color:#6b7280;font-size:13px">Tautan berlaku 7 hari. Anda harus memiliki akun Rekhastha dengan email yang sama untuk menerima undangan ini.</p>` +
      `</div>`,
    text:
      `${companyName} mengundang Anda bergabung sebagai ${label} di Rekhastha.

Terima undangan: ${link}

Tautan berlaku 7 hari.`,
  });
}
