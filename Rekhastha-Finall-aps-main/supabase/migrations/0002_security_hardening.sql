-- Rekhastha security hardening. Safe to run more than once.
-- Run in the Supabase SQL editor AFTER deploying the matching API/frontend.

-- 1. Storage bucket: only accept the file types the app actually allows,
--    and keep the 10 MB cap. (Storage-level defence behind the API checks.)
update storage.buckets
set
  file_size_limit = 10485760,
  allowed_mime_types = array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
where id = 'rekhastha-private';

-- 2. Realtime: private `admin` channel (SOS with worker phone/address,
--    payouts, attendance). Only a token carrying the `app_role = admin`
--    claim may read it. Such tokens are minted by the API after it has
--    verified the admin session cookie, signed with SUPABASE_JWT_SECRET.
drop policy if exists "rekhastha_read_admin_channel" on realtime.messages;
create policy "rekhastha_read_admin_channel"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.topic() = 'admin'
    and (select auth.jwt() ->> 'app_role') = 'admin'
    and realtime.messages.extension = 'broadcast'
  );
