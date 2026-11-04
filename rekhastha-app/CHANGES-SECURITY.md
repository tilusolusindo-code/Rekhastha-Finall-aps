# Security hardening (Nov 2026)

API (artifacts/api-server)
- password-reset: reset token is no longer returned by /auth/forgot-password (was an account-takeover hole). Sent by email via lib/mailer.ts (Resend). Per-IP + per-email rate limit, req.ip instead of raw X-Forwarded-For, all sessions revoked after a reset.
- sessions: login revokes the session cookie the browser presented (user + admin); admin password change signs out other admin sessions.
- csrf: lib/csrf.ts origin guard on all /api unsafe methods (production only).
- uploads: application attachments uploaded straight to storage are now checked by magic bytes on /complete (bad files are deleted); non-image documents are served as attachments.
- emergency: workers only, field length caps, 30 s cooldown per worker.
- realtime: SOS / payouts / attendance moved off the public `feed` channel to private `admin` + per-user channels. /realtime/token?scope=admin issues the admin token.
- logger: extra redaction paths for secrets.

Frontend (artifacts/jakarta-gig-finder)
- RealtimeSocket({ admin: true }) for the admin console and the SOS alarm.
- Forgot-password screen: "link sent to your email" flow.

Database / config
- supabase/migrations/0002_security_hardening.sql  (run in Supabase SQL editor)
- New env vars (see .env.example): RESEND_API_KEY, MAIL_FROM, APP_BASE_URL
