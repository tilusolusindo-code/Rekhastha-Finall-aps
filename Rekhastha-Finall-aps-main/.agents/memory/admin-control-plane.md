---
name: Admin control-plane persistence
description: Why admin sessions and the login throttle live in Postgres, and the async guard contract. Also covers the DB-backed credential system and recovery flow.
---

# Admin control-plane persistence

Admin ("Tilu Saudara Solusindo") auth is separate from user accounts: its own httpOnly
cookie (`rekhastha_admin`), Postgres-backed session store and per-IP throttle.

## Credential storage

Admin passwords are now stored in the `admin_users` table (bcrypt hash, salt
rounds 10) — not compared directly against env secrets. The `ADMIN_TOKEN` env
secret is **only** a recovery key, and there are no source-code fallback admin
credentials.

`ADMIN_ID` is the target ID for recovery. Initial setup and recovery happen
through the reset-password form: it accepts a new password, uses `ADMIN_TOKEN`
to authorize the operation, applies `ADMIN_ID`, stores only the bcrypt hash,
and revokes existing sessions. It creates an account if none exists, renames a
single existing account, and refuses ambiguous renames if several accounts
exist (unless `ADMIN_ID` already identifies one).

**Why:** previously the operator couldn't change their own credentials without
editing Replit Secrets + redeploying. Keeping the recovery key separate from
the daily password avoids treating a long-lived recovery credential as an
initial login password.

**How to apply:**
- `verifyAdminPassword(adminId, password)` is **async** (bcrypt.compare).
- `changeAdminPassword(adminId, oldPw, newPw)` — requires active session; returns
  `{ok:true}` or `{error:string}`.
- `resetAdminPassword(newPw, recoveryToken)` — public recovery; checks the
  configured `ADMIN_TOKEN`, rotates to configured `ADMIN_ID`, and revokes
  sessions. The HTTP route rate-limits failed recovery attempts by IP.
- `bootstrapAdminUser()` is retained as a no-op startup hook; do not re-seed
  the daily password from `ADMIN_TOKEN`.

## Session + throttle persistence

Both the **session store** and the **per-IP brute-force throttle** are
Postgres-backed (`admin_sessions`, `admin_login_attempts`), not in-memory.

**Why:** in-memory state logged every admin out on each API restart and reset
the throttle counters, so a restart silently cleared brute-force lockouts on a
control plane that can suspend users and force-release escrow.

**How to apply:**
- All session/throttle helpers are **async**. `requireAdmin(req)` returns
  `Promise<boolean>` — every route guard must `await` it.
- DB-backed (not stateless token) is deliberate so logout still revokes
  server-side.
- `pruneAdminState()` opportunistically clears expired sessions and stale
  lockout rows; it runs on the login path, not on the hot read path.

## Frontend

- Login page: `/admin` — field label is "Kata Sandi" (was "Kode Token/Passkey").
  "Lupa kata sandi? Gunakan token pemulihan" link toggles to a reset form that
  takes `adminId + ADMIN_TOKEN + newPassword`.
- Inside CommandCenter: "🔑 Pengaturan Akun" tab → `ChangePasswordTab` — lets
  logged-in admin change their password (old → new, min 8 chars).
