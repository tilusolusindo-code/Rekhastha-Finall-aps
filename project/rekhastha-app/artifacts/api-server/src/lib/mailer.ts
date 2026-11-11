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
