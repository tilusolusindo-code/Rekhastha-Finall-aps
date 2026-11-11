# Deploying Rekhastha on Vercel + Supabase

## What changed from the Replit setup
| Was (Replit) | Now |
|---|---|
| Express server + WebSocket hub (`/api/ws`) | One Vercel serverless function (`/api/*`) + **Supabase Realtime** broadcast |
| Replit Postgres | **Supabase Postgres** (pooled connection) |
| Replit object storage / local `uploads/` | **Supabase Storage** private bucket `rekhastha-private` |
| In-memory Maps (QR tokens, Google sign-in codes, radar counters) | `ephemeral_kv` table in Postgres |
| Vite dev server on `PORT`/`BASE_PATH` | Static build on Vercel's CDN |

Realtime: the API publishes to Supabase (`feed` = public, `user:<id>` = private, protected by RLS);
the browser subscribes directly through `src/lib/realtime-socket.ts`, a drop-in for the old WebSocket.

## 1. Supabase
1. Create a project. Copy: Project URL, anon key, service-role key, JWT secret (Project Settings -> API),
   and the **Transaction pooler** connection string (Connect).
2. Run `supabase/migrations/0001_setup.sql` in the SQL editor.
3. Realtime settings: leave "Allow public access" **on** (needed for the public `feed` channel).
4. Create the tables: `DATABASE_URL="<session-pooler or direct URL, port 5432>" pnpm --filter @workspace/db run push`.
5. `pnpm install` once locally so `pnpm-lock.yaml` picks up `@supabase/supabase-js`.

## 2. Vercel
1. Import the repo (root directory = repo root, framework = Other). `vercel.json` sets the install/build commands.
2. Add every variable from `.env.example`.
3. Deploy. Check `/api/healthz`.

## 3. After the first deploy
- Google OAuth: add `https://<your-domain>/api/auth/google/callback` as an authorized redirect URI.
- Midtrans / Xendit: point webhook URLs at the new domain.
- Re-run `0001_setup.sql` is NOT needed after schema changes (an event trigger enables RLS on new tables).

## Known limits to be aware of
- **Upload size:** Vercel rejects request bodies over 4.5 MB. KYC photos and CV/portfolio files are now capped at
  2 MB per file (two per request); chat attachments at 4 MB. Application attachments are unaffected (direct-to-storage).
- Existing Replit data and uploaded files are not migrated by this change.
