-- FreePT important alerts: isolated from chat, attachments and Bridge.
-- Only server-side admin-authenticated Edge Function can create alerts.
create table if not exists public.important_alerts (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  title text not null default '' check (char_length(title) <= 120),
  body text not null check (char_length(body) between 1 and 750),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists important_alerts_recipient_unread_idx
  on public.important_alerts(recipient_id, created_at) where read_at is null;
alter table public.important_alerts enable row level security;
revoke all on public.important_alerts from public, anon, authenticated, service_role;
grant select on public.important_alerts to authenticated, service_role;
grant insert on public.important_alerts to service_role;
grant update (read_at) on public.important_alerts to authenticated;
create policy "alert participants read" on public.important_alerts
 for select to authenticated
 using (recipient_id = (select auth.uid()) or sender_id = (select auth.uid()));
create policy "alert recipient acknowledges" on public.important_alerts
 for update to authenticated
 using (recipient_id = (select auth.uid()))
 with check (recipient_id = (select auth.uid()));
-- No direct client INSERT permission. The Edge Function checks an approved administrator.
