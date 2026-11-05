/**
 * Unified email dispatcher — tries Gmail API first (Google Cloud),
 * falls back to Resend HTTP API if configured.
 *
 * Required env (at least one pair):
 *   Option A (Google Cloud): GOOGLE_SERVICE_ACCOUNT_JSON + GMAIL_SENDER_ADDRESS + APP_BASE_URL
 *   Option B (Resend):       RESEND_API_KEY + MAIL_FROM + APP_BASE_URL
 */

export {
  appBaseUrl,
  gmailConfigured,
  sendPasswordResetEmail,
  sendWelcomeEmail,
  sendApplicationStatusEmail,
  sendPayoutNotificationEmail,
} from "./gmail";

import { gmailConfigured } from "./gmail";

export function mailerConfigured(): boolean {
  return gmailConfigured() || Boolean(process.env["RESEND_API_KEY"] && process.env["MAIL_FROM"]);
}
export async function sendTeamInvitationEmail(params: {
  to: string;
  companyName: string;
  role: "hr" | "supervisor" | "finance";
  link: string;
}): Promise<boolean> {
  const roleLabel: Record<string, string> = {
    hr: "HR / Rekrutmen",
    supervisor: "Supervisor Lapangan",
    finance: "Keuangan",
  };
  const { to, companyName, role, link } = params;
  const label = roleLabel[role] ?? role;
  const esc = (s: string) => s.replace(/[&<>"']/g, c =>
    ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" })[c] ?? c);
  return sendViaResend({
    to,
    subject: `${esc(companyName)} mengundang Anda bergabung ke tim Rekhastha`,
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
