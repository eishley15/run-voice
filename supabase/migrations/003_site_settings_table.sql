-- site_settings: single-row key/value table for admin-editable landing page content.
-- Policy: anon SELECT only (public landing page reads it, unauthenticated) —
-- no anon/authenticated INSERT/UPDATE/DELETE policy, so writes only succeed
-- via the service-role admin client (RLS bypass), matching admin.html's model.

create table if not exists public.site_settings (
  id         text        primary key default 'landing',
  heading    text        not null default 'Leave a voice message<br />for the run.',
  updated_at timestamptz not null default now()
);

alter table public.site_settings enable row level security;

create policy "anon_select" on public.site_settings
  for select
  to anon
  using (true);

insert into public.site_settings (id)
values ('landing')
on conflict (id) do nothing;
