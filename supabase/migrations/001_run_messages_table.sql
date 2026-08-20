-- run_messages metadata table
-- Stores the original (unsanitized) display name alongside the storage path
-- so names with non-ASCII characters are preserved.
-- Policy: anon INSERT only — no anon SELECT, UPDATE, or DELETE.

create table if not exists public.run_messages (
  id               bigserial primary key,
  display_name     text          not null default 'anonymous',
  file_path        text          not null,
  duration_seconds integer       not null default 0,
  mime_type        text          not null,
  created_at       timestamptz   not null default now()
);

-- Enable RLS
alter table public.run_messages enable row level security;

-- Anon callers may INSERT but not read back their own rows
create policy "anon_insert" on public.run_messages
  for insert
  to anon
  with check (true);

-- Authenticated users (admin) can read everything
create policy "authed_select" on public.run_messages
  for select
  to authenticated
  using (true);
