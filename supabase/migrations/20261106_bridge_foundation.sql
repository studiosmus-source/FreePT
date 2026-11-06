-- Bridge schema DRAFT: review and test on an isolated Supabase project FIRST.
-- Do not run against production until backend authentication and transaction
-- boundaries are implemented. No changes to existing FreePT chat tables.
--
-- service_role bypasses RLS: only a trusted backend may possess that key.
-- NO direct INSERT / UPDATE / DELETE grants for client identities.

create table if not exists public.bridge_devices (
  id uuid primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  label text not null check (length(label) between 1 and 100),
  bridge_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bridge_grants (
  device_id uuid not null references public.bridge_devices(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  approved_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key(device_id,receiver_id),
  check(revoked_at is null or revoked_at >= approved_at)
);

create index if not exists bridge_devices_owner_idx
  on public.bridge_devices(owner_id);

create index if not exists bridge_grants_receiver_active_idx
  on public.bridge_grants(receiver_id,device_id) where revoked_at is null;

alter table public.bridge_devices enable row level security;
alter table public.bridge_grants enable row level security;

-- Do not permit direct client writes: backend must validate owner consent,
-- device authentication and the admin receiver identity on every mutation.
revoke all on public.bridge_devices from public, anon, authenticated;
revoke all on public.bridge_grants from public, anon, authenticated;
grant select on public.bridge_devices to authenticated;
grant select on public.bridge_grants to authenticated;

drop policy if exists "bridge devices owner read" on public.bridge_devices;
create policy "bridge devices owner read"
  on public.bridge_devices for select to authenticated
  using (owner_id = (select auth.uid())
    and (select public.freept_is_approved()));

drop policy if exists "bridge devices admin granted read" on public.bridge_devices;
create policy "bridge devices admin granted read"
  on public.bridge_devices for select to authenticated
  using (
    (select public.freept_is_admin())
    and exists (
      select 1 from public.bridge_grants g
      where g.device_id=bridge_devices.id
        and g.receiver_id=(select auth.uid())
        and g.revoked_at is null
    )
  );

drop policy if exists "bridge grants owner read" on public.bridge_grants;
create policy "bridge grants owner read"
  on public.bridge_grants for select to authenticated
  using (
    (select public.freept_is_approved())
    and exists (
      select 1 from public.bridge_devices d
      where d.id=bridge_grants.device_id and d.owner_id=(select auth.uid())
    )
  );

drop policy if exists "bridge grants receiver admin read" on public.bridge_grants;
create policy "bridge grants receiver admin read"
  on public.bridge_grants for select to authenticated
  using (
    receiver_id=(select auth.uid())
    and (select public.freept_is_admin())
  );

-- No presence/heartbeat records here: online is ephemeral and must be proved
-- by an authenticated connection. revoked_at remains durable after revocation.
-- Note: these tables alone cannot provide secure device credentials or a
-- server API; no Bridge session/transfer functionality is enabled by this SQL.
