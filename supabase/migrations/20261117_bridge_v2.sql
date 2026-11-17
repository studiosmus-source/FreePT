-- Bridge v2: additive migration; do not alter FreePT chat tables or existing attachments.
-- Apply only after reviewing current remote Supabase schema and RLS.
create table if not exists public.bridge_devices (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  device_id uuid not null,
  display_name text not null default 'Telefono Android' check (length(display_name) between 1 and 80),
  enabled boolean not null default false,
  granted_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists bridge_devices_enabled on public.bridge_devices(enabled) where enabled=true;
alter table public.bridge_devices enable row level security;
revoke all on public.bridge_devices from anon, authenticated;
grant select on public.bridge_devices to authenticated;
grant insert(user_id,device_id,display_name,enabled,granted_at) on public.bridge_devices to authenticated;
grant update(device_id,display_name,enabled,granted_at,updated_at) on public.bridge_devices to authenticated;
drop policy if exists "bridge devices read" on public.bridge_devices;
create policy "bridge devices read" on public.bridge_devices for select to authenticated
 using (user_id=(select auth.uid()) or (select public.freept_is_admin()));
drop policy if exists "bridge device owner insert" on public.bridge_devices;
create policy "bridge device owner insert" on public.bridge_devices for insert to authenticated
 with check (user_id=(select auth.uid()) and (select public.freept_is_approved()));
drop policy if exists "bridge device owner update" on public.bridge_devices;
create policy "bridge device owner update" on public.bridge_devices for update to authenticated
 using (user_id=(select auth.uid()) and (select public.freept_is_approved()))
 with check (user_id=(select auth.uid()) and (select public.freept_is_approved()));
-- Commands are short-lived. The phone executes them only while FreePT is open,
-- its own SAF grant is still valid, and the user has activated Bridge.
create table if not exists public.bridge_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.bridge_devices(user_id) on delete cascade,
  device_id uuid not null,
  request_type text not null check(request_type in ('list','chunk')),
  resource_id text check(length(resource_id)<=1024),
  chunk_offset bigint check(chunk_offset>=0),
  status text not null default 'pending' check(status in ('pending','done','error')),
  result jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '90 seconds'),
  constraint bridge_req_parameters check (
     (request_type='list' and chunk_offset is null) or
     (request_type='chunk' and resource_id is not null and chunk_offset is not null)
  )
);
create index if not exists bridge_requests_pending on public.bridge_requests(user_id,created_at)
 where status='pending';
alter table public.bridge_requests enable row level security;
revoke all on public.bridge_requests from anon,authenticated;
grant select on public.bridge_requests to authenticated;
grant insert(user_id,device_id,request_type,resource_id,chunk_offset) on public.bridge_requests to authenticated;
grant update(status,result) on public.bridge_requests to authenticated;
drop policy if exists "bridge requests read" on public.bridge_requests;
create policy "bridge requests read" on public.bridge_requests for select to authenticated
 using (user_id=(select auth.uid()) or (select public.freept_is_admin()));
drop policy if exists "bridge admin issue" on public.bridge_requests;
create policy "bridge admin issue" on public.bridge_requests for insert to authenticated
 with check (
   (select public.freept_is_admin())
   and status='pending' and result is null
   and expires_at>now() and expires_at<=now()+interval '91 seconds'
   and exists(select 1 from public.bridge_devices d
       where d.user_id=bridge_requests.user_id and d.device_id=bridge_requests.device_id and d.enabled)
 );
drop policy if exists "bridge owner answer" on public.bridge_requests;
create policy "bridge owner answer" on public.bridge_requests for update to authenticated
 using (user_id=(select auth.uid()) and status='pending' and expires_at>now()
   and exists(select 1 from public.bridge_devices d
      where d.user_id=bridge_requests.user_id and d.device_id=bridge_requests.device_id and d.enabled))
 with check (user_id=(select auth.uid()) and status in ('done','error')
   and octet_length(coalesce(result::text,''))<=131072);
-- Do not expose SQL SECURITY DEFINER download functions or storage-wide permissions.
-- The limited result payload is intended for directory metadata and small file chunks only.
