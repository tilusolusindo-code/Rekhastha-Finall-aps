-- Rekhastha on Supabase — one-time setup.
-- Run this FIRST (SQL editor, or the Supabase MCP / CLI), THEN run
--   pnpm --filter @workspace/db run push
-- so the Drizzle tables are created with row-level security already enforced.

-- 1. Extensions used by the radar search (earth_box / earth_distance).
create extension if not exists cube with schema extensions;
create extension if not exists earthdistance with schema extensions;

-- 2. Lock down the Data API.
--    Supabase exposes every table in `public` over REST with the anon key
--    (which ships inside the browser bundle). All Rekhastha data access goes
--    through the Express API using the server-side `postgres` connection,
--    which bypasses RLS — so enabling RLS with NO policies makes the tables
--    unreachable for anon/authenticated clients, which is what we want.
create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  cmd record;
begin
  for cmd in
    select * from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table', 'partitioned table')
  loop
    if cmd.schema_name = 'public' then
      execute format('alter table if exists %s enable row level security', cmd.object_identity);
    end if;
  end loop;
end;
$$;

drop event trigger if exists ensure_rls;
create event trigger ensure_rls
  on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  execute function public.rls_auto_enable();

-- Cover any tables that already exist.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end
$$;

-- 3. Private storage bucket for KYC photos, CVs, chat files and application
--    attachments. Private = no public URLs; access is via signed URLs only.
insert into storage.buckets (id, name, public, file_size_limit)
values ('rekhastha-private', 'rekhastha-private', false, 10485760)
on conflict (id) do nothing;

-- 4. Realtime authorization for per-user channels.
--    The API mints a short-lived JWT whose `sub` is the Rekhastha user id and
--    the browser joins the PRIVATE channel `user:<id>`. A client may only
--    receive messages on the channel matching its own `sub`.
--    (The public `feed` channel needs no policy; make sure
--    Realtime Settings -> "Allow public access" is ON.)
drop policy if exists "rekhastha_read_own_user_channel" on realtime.messages;
create policy "rekhastha_read_own_user_channel"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.topic() = 'user:' || (select auth.jwt() ->> 'sub')
    and realtime.messages.extension = 'broadcast'
  );
