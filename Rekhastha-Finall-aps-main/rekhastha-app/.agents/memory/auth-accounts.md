---
name: Real user accounts & sessions
description: How Rekhastha auth works (Postgres users + opaque session cookie) and the non-obvious constraints.
---

# Real auth (users + sessions)

Auth is custom email/password on our own Postgres — deliberately NOT Clerk /
Replit Auth. **Why:** the app already has a bespoke Indonesian login UI with role
selection (pekerja/perusahaan) and a rich `AuthUser` shape (KTP, NPWP, NIB,
employer category, etc.); a hosted auth provider would replace that UX for no
gain. Passwords are bcrypt-hashed; sessions are opaque UUIDs stored server-side
and referenced by an httpOnly cookie (`rekhastha_session`).

## Decisions & why

- **AuthUser extras live in a `profile` jsonb column**, not individual columns.
  `toAuthUser()` spreads `profile` then overlays the core identity columns. Only
  the extras that are never queried on their own go in the blob (id/email/name/
  role/whatsapp/linkedWithGoogle stay as columns).

- **Every browser auth call needs `credentials: "include"`.** The session is an
  httpOnly cookie; omit this and the cookie is neither stored nor sent, so login
  "works" but `/me` returns 401 on the next load.

- **Do NOT delete other sessions on login.** Multi-device is the core product
  (an employer phone and a worker phone are both logged in at once). Clearing
  prior sessions on login would log the other device out. Session-table growth is
  accepted; if it ever matters, add lazy expired-session cleanup, never
  login-time purge.

- **Login uses the server-stored role; role selection is only for registration**
  and a first-time Google OAuth account. Do not re-prompt role on plain login or
  when an existing Google email is recognized.

- **Google login uses real server-side authorization-code OAuth**, accepts only
  verified Google email identities, and links an existing Rekhastha account
  without replacing its role. Missing `GOOGLE_CLIENT_ID` or
  `GOOGLE_CLIENT_SECRET` must fail clearly; never fall back to a demo identity.
  **Why:** a simulated Google account appeared to authenticate successfully
  without proving ownership of the email. **How to apply:** configure both values
  in Replit Secrets and register `/api/auth/google/callback` for each app host.

- **Logout is best-effort and must not throw.** The UI clears local state
  optimistically; `auth-client.logout()` retries with `keepalive` so a dropped
  request doesn't orphan a server session that `/me` would silently restore.

## How to apply

- Session restore: `home.tsx` calls `/api/auth/me` on mount behind an
  `authChecking` splash so the login screen never flashes for a logged-in user.
- Web app is served at `/`, so the auth client uses a root-relative `/api` base
  (same as `central-server.ts`).
