-- Storage bucket policies for run-messages
-- Run this in the Supabase SQL editor after creating the bucket in the dashboard.

-- 1. Create the bucket (skip if already created via dashboard)
-- insert into storage.buckets (id, name, public, file_size_limit)
-- values ('run-messages', 'run-messages', false, 209715200)  -- 200 MB
-- on conflict do nothing;

-- 2. Allow anonymous INSERT (upload) — this is what contributors use
create policy "anon_upload" on storage.objects
  for insert
  to anon
  with check (bucket_id = 'run-messages');

-- 3. Block anonymous SELECT, LIST, UPDATE, DELETE
-- (The absence of policies for these operations is sufficient, but explicit
--  denials make the intent clear if policies are later added by mistake.)

-- Authenticated admin can do everything
create policy "authed_all" on storage.objects
  for all
  to authenticated
  using (bucket_id = 'run-messages')
  with check (bucket_id = 'run-messages');
