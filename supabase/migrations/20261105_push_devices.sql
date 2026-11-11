-- FreePT Android push registration, no messages or profiles are modified.
-- Apply once in the dedicated Supabase project after reviewing it.
create table if not exists public.push_devices (
  token text primary key check(length(token) between 30 and 4096),
  user_id uuid not null references public.profiles(id) on delete cascade,
  platform text not null default 'android' check(platform='android'),
  updated_at timestamptz not null default now()
);
create index if not exists push_devices_user_id_idx on public.push_devices(user_id);
alter table public.push_devices enable row level security;
revoke all on public.push_devices from public, anon;
grant select,insert,update,delete on public.push_devices to authenticated;
drop policy if exists "push own read" on public.push_devices;
create policy "push own read" on public.push_devices
  for select to authenticated using (user_id=(select auth.uid()));
drop policy if exists "push own insert" on public.push_devices;
create policy "push own insert" on public.push_devices
  for insert to authenticated with check (
    user_id=(select auth.uid()) and (select public.freept_is_approved())
  );
drop policy if exists "push own update" on public.push_devices;
create policy "push own update" on public.push_devices
  for update to authenticated
  using (user_id=(select auth.uid()))
  with check (user_id=(select auth.uid()) and (select public.freept_is_approved()));
drop policy if exists "push own delete" on public.push_devices;
create policy "push own delete" on public.push_devices
  for delete to authenticated using (user_id=(select auth.uid()));
-- No database webhook configured here: the secret is configured separately
-- in Supabase Dashboard Database > Webhooks, never committed to GitHub.
