-- FREEPT BRIDGE - ONE-TIME STAGING INSTALL
-- Source: studiosmus-source/FreePT @ 98235b8446e598a801bf44c07a45f4d18ff62dcd
-- Database target: FreePT-Bridge-Test ONLY (aqjuixbuxtnjfzxmzuj).
-- NEVER run on the production FreePT project.
-- Combined in migration order, including the family consent RPC.
-- Transaction: if any statement fails, ROLLBACK all changes.
-- Before running: confirm SQL Editor header reads FreePT-Bridge-Test.
BEGIN;
DO $bridge_staging_preflight$
BEGIN
 IF to_regclass('public.profiles') IS NULL OR
    to_regprocedure('public.freept_is_admin()') IS NULL OR
    to_regprocedure('public.freept_is_approved()') IS NULL THEN
  RAISE EXCEPTION 'BRIDGE STOP: missing staging FreePT identity prerequisites';
 END IF;
 IF to_regclass('public.bridge_devices') IS NOT NULL THEN
  RAISE EXCEPTION 'BRIDGE STOP: Bridge already installed; do not reapply bundle';
 END IF;
END;
$bridge_staging_preflight$;


-- ===== 1/14: 20261106_bridge_foundation.sql =====
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

-- SECURITY DEFINER avoids recursive RLS evaluation between grants and devices.
-- This function only answers for the authenticated approved admin account.
create or replace function public.bridge_admin_has_active_grant(p_device_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select (select public.freept_is_admin()) and exists (
    select 1 from public.bridge_grants g
    where g.device_id=p_device_id
      and g.receiver_id=(select auth.uid())
      and g.revoked_at is null
  );
$$;
revoke all on function public.bridge_admin_has_active_grant(uuid) from public, anon;
grant execute on function public.bridge_admin_has_active_grant(uuid) to authenticated;

drop policy if exists "bridge devices admin granted read" on public.bridge_devices;
create policy "bridge devices admin granted read"
  on public.bridge_devices for select to authenticated
  using (
    (select public.bridge_admin_has_active_grant(bridge_devices.id))
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

-- ===== 2/13: 20261106_bridge_owner_controls.sql =====
-- DRAFT: install ONLY on a disposable test database after bridge_foundation.
-- Owner-scoped mutations for existing, trusted-server-registered devices.
-- This does NOT register a device or prove device possession.
-- Device service authentication and in-flight transfer cancellation remain backend responsibilities.
--
-- SECURITY DEFINER is intentional: the client has no direct table writes.
-- Every entry point derives the owner identity from auth.uid() and locks the
-- specific device row; p_device_id is never treated as proof of ownership.

create or replace function public.bridge_owner_set_enabled(
  p_device_id uuid, p_enabled boolean
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or not (select public.freept_is_approved()) then
    raise exception 'bridge_owner_not_approved' using errcode = '42501';
  end if;
  if p_device_id is null or p_enabled is null then
    raise exception 'invalid_bridge_request' using errcode = '22023';
  end if;

  perform 1 from public.bridge_devices
    where id = p_device_id and owner_id = (select auth.uid())
    for update;
  if not found then
    raise exception 'bridge_owner_required' using errcode = '42501';
  end if;

  update public.bridge_devices
    set bridge_enabled = p_enabled, updated_at = clock_timestamp()
    where id = p_device_id;
end;
$$;

create or replace function public.bridge_owner_grant(
  p_device_id uuid, p_receiver_id uuid
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or not (select public.freept_is_approved()) then
    raise exception 'bridge_owner_not_approved' using errcode = '42501';
  end if;
  if p_device_id is null or p_receiver_id is null then
    raise exception 'invalid_bridge_request' using errcode = '22023';
  end if;

  perform 1 from public.bridge_devices
    where id = p_device_id and owner_id = (select auth.uid())
    for update;
  if not found then
    raise exception 'bridge_owner_required' using errcode = '42501';
  end if;

  -- Only an approved admin may be granted access as a receiver.
  if not exists (
    select 1 from public.profiles p
    where p.id = p_receiver_id and p.role = 'admin' and p.status = 'approved'
  ) then
    raise exception 'bridge_receiver_not_admin' using errcode = '42501';
  end if;

  insert into public.bridge_grants(device_id, receiver_id, approved_at, revoked_at)
    values(p_device_id, p_receiver_id, clock_timestamp(), null)
    on conflict(device_id, receiver_id) do update
    set approved_at = excluded.approved_at, revoked_at = null;
end;
$$;

create or replace function public.bridge_owner_revoke(
  p_device_id uuid, p_receiver_id uuid
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or not (select public.freept_is_approved()) then
    raise exception 'bridge_owner_not_approved' using errcode = '42501';
  end if;
  if p_device_id is null or p_receiver_id is null then
    raise exception 'invalid_bridge_request' using errcode = '22023';
  end if;

  perform 1 from public.bridge_devices
    where id = p_device_id and owner_id = (select auth.uid())
    for update;
  if not found then
    raise exception 'bridge_owner_required' using errcode = '42501';
  end if;

  update public.bridge_grants
    set revoked_at = greatest(clock_timestamp(), approved_at)
    where device_id = p_device_id and receiver_id = p_receiver_id
      and revoked_at is null;
end;
$$;

-- The untrusted client can call only these narrow, owner-verified operations.
-- No INSERT/UPDATE/DELETE access to bridge_* tables is granted.
revoke all on function public.bridge_owner_set_enabled(uuid, boolean)
  from public, anon;
revoke all on function public.bridge_owner_grant(uuid, uuid)
  from public, anon;
revoke all on function public.bridge_owner_revoke(uuid, uuid)
  from public, anon;

grant execute on function public.bridge_owner_set_enabled(uuid, boolean)
  to authenticated;
grant execute on function public.bridge_owner_grant(uuid, uuid)
  to authenticated;
grant execute on function public.bridge_owner_revoke(uuid, uuid)
  to authenticated;

-- ===== 3/13: 20261106_bridge_device_verifiers.sql =====
-- DRAFT for isolated test database only, AFTER bridge_foundation.sql.
-- A trusted backend must issue a 256-bit token using a CSPRNG, derive its
-- salted SHA-256 verifier using the domain tag from deviceCredentials.mjs,
-- and store ONLY its salt/verifier here. Never store a raw bearer secret.
--
-- This table is deliberately inaccessible to both owner and admin clients.
-- It is NOT a registration API, secure pairing protocol or HTTP endpoint.

create table if not exists public.bridge_device_verifiers (
  device_id uuid primary key references public.bridge_devices(id) on delete cascade,
  salt_hex text not null check (salt_hex ~ '^[0-9a-f]{32}$'),
  verifier_hex text not null check (verifier_hex ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  rotated_at timestamptz not null default clock_timestamp()
);

alter table public.bridge_device_verifiers enable row level security;
revoke all on public.bridge_device_verifiers from public, anon, authenticated;
-- No client SELECT policy, even for an admin or the device owner.
-- The service-role backend must check the authenticated owner and device
-- authorization before issuing, rotating or revoking one verifier.
-- Server state must be checked on every session establishment and reauth.

-- ===== 4/13: 20261106_bridge_audit.sql =====
-- DRAFT only: audit of owner consent and Bridge access changes.
-- Apply to an isolated test project AFTER bridge_foundation and bridge_owner_controls.
-- Event writes are generated by database triggers in the SAME transaction
-- as the change, including trusted service_role operations.
-- This log is not a substitute for device authentication or transfer auditing.

create table if not exists public.bridge_audit_events (
  id bigint generated always as identity primary key,
  device_id uuid not null references public.bridge_devices(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid references public.profiles(id) on delete set null,
  actor_id uuid,
  event_type text not null check (
    event_type in ('bridge_enabled','bridge_disabled','access_granted','access_revoked')
  ),
  occurred_at timestamptz not null default clock_timestamp()
);

create index if not exists bridge_audit_owner_time
  on public.bridge_audit_events(owner_id, occurred_at desc);

alter table public.bridge_audit_events enable row level security;
revoke all on public.bridge_audit_events from public, anon, authenticated;
grant select on public.bridge_audit_events to authenticated;

drop policy if exists "bridge audit owner read" on public.bridge_audit_events;
create policy "bridge audit owner read" on public.bridge_audit_events
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    and (select public.freept_is_approved())
  );

-- Do not allow user-invoked RPCs to fake audit rows.
create or replace function public.bridge_audit_device_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if old.bridge_enabled is distinct from new.bridge_enabled then
    insert into public.bridge_audit_events(
      device_id, owner_id, actor_id, event_type
    ) values(
      new.id, new.owner_id, (select auth.uid()),
      case when new.bridge_enabled then 'bridge_enabled' else 'bridge_disabled' end
    );
  end if;
  return new;
end;
$$;

create or replace function public.bridge_audit_grant_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_event text;
begin
  if tg_op = 'INSERT' then
    if new.revoked_at is not null then
      return new;
    end if;
    v_event := 'access_granted';
  elsif old.revoked_at is distinct from new.revoked_at then
    if new.revoked_at is null then
      v_event := 'access_granted';
    else
      v_event := 'access_revoked';
    end if;
  else
    return new;
  end if;

  select d.owner_id into v_owner_id
    from public.bridge_devices d where d.id = new.device_id;
  if v_owner_id is null then
    raise exception 'bridge_audit_device_missing' using errcode='23503';
  end if;

  insert into public.bridge_audit_events(
    device_id, owner_id, receiver_id, actor_id, event_type
  ) values(
    new.device_id, v_owner_id, new.receiver_id, (select auth.uid()), v_event
  );
  return new;
end;
$$;

revoke all on function public.bridge_audit_device_change() from public, anon, authenticated;
revoke all on function public.bridge_audit_grant_change() from public, anon, authenticated;

drop trigger if exists bridge_audit_device_switch on public.bridge_devices;
create trigger bridge_audit_device_switch
  after update of bridge_enabled on public.bridge_devices
  for each row execute function public.bridge_audit_device_change();

drop trigger if exists bridge_audit_grant_lifecycle on public.bridge_grants;
create trigger bridge_audit_grant_lifecycle
  after insert or update on public.bridge_grants
  for each row execute function public.bridge_audit_grant_change();

-- No direct client write privilege, no client-accessible audit RPC.
-- IMPORTANT: deleting a Bridge device cascades and removes its audit events;
-- use a separate retention store if historical records must survive deletion.

-- ===== 5/13: 20261106_bridge_jobs_staging.sql =====
-- STAGING DRAFT ONLY. NEVER run against FreePT production.
-- Install after bridge_foundation and bridge_owner_controls, on disposable DB.
-- This file does NOT enable a TX network endpoint or authenticate a phone.
--
-- All job mutations occur in PostgreSQL transactions, under the same
-- bridge_devices row lock taken by bridge_owner_* consent changes.
-- The caller must verify Supabase Auth (admin), device secret/session (TX),
-- and transport TLS OUTSIDE these service_role-only database functions.
-- Critical: direct service_role writes to bridge_grants/profiles must honor
-- the device lock and revoke/approve fencing; profile status changes do not
-- currently acquire this device lock. Full cross-table serializability
-- requires a dedicated backend transaction/revocation protocol.

create table if not exists public.bridge_jobs (
  id uuid primary key,
  device_id uuid not null references public.bridge_devices(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  operation text not null default 'list' check (operation = 'list'),
  state text not null default 'queued'
    check (state in ('queued', 'sent', 'done', 'cancelled')),
  -- SHA-256 digest of a bound authenticated TX session; never bearer token.
  session_binding_hex text check (
    session_binding_hex is null or session_binding_hex ~ '^[0-9a-f]{64}$'
  ),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  updated_at timestamptz not null default clock_timestamp(),
  check (expires_at > created_at),
  check (state <> 'sent' or session_binding_hex is not null)
);

create index if not exists bridge_jobs_device_state_idx
  on public.bridge_jobs(device_id, state, created_at, id);
create index if not exists bridge_jobs_receiver_idx
  on public.bridge_jobs(receiver_id, created_at desc);

alter table public.bridge_jobs enable row level security;
revoke all on public.bridge_jobs from public, anon, authenticated;
-- No policies: only trusted backend service_role may read/write jobs.

-- Enqueue: the server supplies the verified admin ID and a random job UUID.
-- The device row lock serializes this operation with owner grant/OFF RPCs.
create or replace function public.bridge_server_enqueue_list(
  p_job_id uuid, p_device_id uuid, p_receiver_id uuid
) returns uuid language plpgsql security invoker set search_path = ''
as $$
begin
  if p_job_id is null or p_device_id is null or p_receiver_id is null then
    raise exception 'invalid_bridge_job' using errcode='22023';
  end if;
  perform 1 from public.bridge_devices d
    where d.id=p_device_id and d.bridge_enabled=true
    for update;
  if not found then
    raise exception 'bridge_unavailable' using errcode='42501';
  end if;
  if not exists(
    select 1 from public.bridge_grants g
      join public.profiles p on p.id=g.receiver_id
      where g.device_id=p_device_id and g.receiver_id=p_receiver_id
        and g.revoked_at is null and p.role='admin' and p.status='approved'
  ) then
    raise exception 'bridge_authority_denied' using errcode='42501';
  end if;
  insert into public.bridge_jobs(
    id,device_id,receiver_id,operation,state,expires_at
  ) values(
    p_job_id,p_device_id,p_receiver_id,'list','queued',
    clock_timestamp() + interval '60 seconds'
  );
  return p_job_id;
end;
$$;

-- Claim: a verified TX may take its oldest queued job. The trusted backend
-- supplies its bound session digest after checking device possession.
-- Same device lock ensures owner consent changes cannot interleave between
-- checking the grant and marking the job sent.
create or replace function public.bridge_server_claim_list(
  p_device_id uuid, p_session_binding_hex text
) returns uuid language plpgsql security invoker set search_path = ''
as $$
declare
  v_job_id uuid;
begin
  if p_device_id is null or p_session_binding_hex is null or
      p_session_binding_hex !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_bridge_session_binding' using errcode='22023';
  end if;
  perform 1 from public.bridge_devices d
    where d.id=p_device_id and d.bridge_enabled=true
    for update;
  if not found then
    raise exception 'bridge_unavailable' using errcode='42501';
  end if;
  select j.id into v_job_id
  from public.bridge_jobs j
  join public.bridge_grants g
    on g.device_id=j.device_id and g.receiver_id=j.receiver_id
  join public.profiles p on p.id=j.receiver_id
  where j.device_id=p_device_id and j.state='queued'
    and j.expires_at > clock_timestamp() and g.revoked_at is null
    and p.role='admin' and p.status='approved'
  order by j.created_at, j.id
  limit 1
  for update of j;
  if v_job_id is null then return null; end if;

  update public.bridge_jobs set
    state='sent',session_binding_hex=p_session_binding_hex,
    updated_at=clock_timestamp()
  where id=v_job_id;
  return v_job_id;
end;
$$;

-- Complete: the server resolves device and session from verified TX auth;
-- the job is immutable across receivers and must have been claimed by this
-- exact TX session. A disabled or revoked grant rejects the completion.
create or replace function public.bridge_server_complete_list(
  p_job_id uuid, p_device_id uuid, p_session_binding_hex text
) returns boolean language plpgsql security invoker set search_path = ''
as $$
declare
  v_job public.bridge_jobs%rowtype;
begin
  if p_job_id is null or p_device_id is null or
      p_session_binding_hex is null or
      p_session_binding_hex !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_bridge_request' using errcode='22023';
  end if;
  perform 1 from public.bridge_devices d
    where d.id=p_device_id and d.bridge_enabled=true
    for update;
  if not found then
    raise exception 'bridge_unavailable' using errcode='42501';
  end if;
  select * into v_job from public.bridge_jobs j
    where j.id=p_job_id and j.device_id=p_device_id
    for update;
  if not found or v_job.state <> 'sent' or
      v_job.expires_at <= clock_timestamp() or
      v_job.session_binding_hex is distinct from p_session_binding_hex then
    raise exception 'bridge_job_not_authorized' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.bridge_grants g
      join public.profiles p on p.id=g.receiver_id
      where g.device_id=v_job.device_id and g.receiver_id=v_job.receiver_id
        and g.revoked_at is null and p.role='admin' and p.status='approved'
  ) then
    raise exception 'bridge_authority_denied' using errcode='42501';
  end if;
  update public.bridge_jobs set
    state='done',updated_at=clock_timestamp()
    where id=p_job_id;
  return true;
end;
$$;

-- No client may invoke the server functions; revoke PUBLIC's default EXECUTE.
revoke all on function public.bridge_server_enqueue_list(uuid,uuid,uuid)
  from public, anon, authenticated;
revoke all on function public.bridge_server_claim_list(uuid,text)
  from public, anon, authenticated;
revoke all on function public.bridge_server_complete_list(uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.bridge_server_enqueue_list(uuid,uuid,uuid)
  to service_role;
grant execute on function public.bridge_server_claim_list(uuid,text)
  to service_role;
grant execute on function public.bridge_server_complete_list(uuid,uuid,text)
  to service_role;

-- No direct client SELECT, INSERT, UPDATE or DELETE grants on bridge_jobs.
-- WARNING: DB never sees the TX secret or authenticated session; do not call
-- these functions with unverified deviceId or session binding.

-- ===== 6/13: 20261106_bridge_job_admin_staging.sql =====
-- ADDITIVE STAGING DRAFT: after 20261106_bridge_jobs_staging.sql.
-- Backend-only status and cancellation. These actions are owned by the
-- originally authenticated admin (receiver_id), even after consent is revoked,
-- so the requester can still inspect/cancel their own pending operation.
-- Never accept receiver_id from a browser: trusted backend derives it from Auth.
-- The device lock is acquired BEFORE the job lock, matching claim/complete.
-- No direct client grants or new network endpoint.
create or replace function public.bridge_server_job_status(
  p_job_id uuid, p_receiver_id uuid
) returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_device_id uuid;
  v_job public.bridge_jobs%rowtype;
begin
  if p_job_id is null or p_receiver_id is null then
    raise exception 'invalid_bridge_request' using errcode='22023';
  end if;
  select j.device_id into v_device_id
    from public.bridge_jobs j
    where j.id=p_job_id and j.receiver_id=p_receiver_id;
  if not found then
    raise exception 'bridge_job_not_authorized' using errcode='42501';
  end if;
  perform 1 from public.bridge_devices d
    where d.id=v_device_id for update;
  if not found then
    raise exception 'bridge_job_not_authorized' using errcode='42501';
  end if;
  select * into v_job from public.bridge_jobs j
    where j.id=p_job_id and j.device_id=v_device_id
      and j.receiver_id=p_receiver_id for update;
  if not found then
    raise exception 'bridge_job_not_authorized' using errcode='42501';
  end if;
  return pg_catalog.jsonb_build_object(
    'jobId',v_job.id,'deviceId',v_job.device_id,'state',v_job.state
  );
end;
$$;

create or replace function public.bridge_server_cancel_job(
  p_job_id uuid, p_receiver_id uuid
) returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_device_id uuid;
  v_job public.bridge_jobs%rowtype;
begin
  if p_job_id is null or p_receiver_id is null then
    raise exception 'invalid_bridge_request' using errcode='22023';
  end if;
  select j.device_id into v_device_id
    from public.bridge_jobs j
    where j.id=p_job_id and j.receiver_id=p_receiver_id;
  if not found then
    raise exception 'bridge_job_not_authorized' using errcode='42501';
  end if;
  perform 1 from public.bridge_devices d
    where d.id=v_device_id for update;
  if not found then
    raise exception 'bridge_job_not_authorized' using errcode='42501';
  end if;
  select * into v_job from public.bridge_jobs j
    where j.id=p_job_id and j.device_id=v_device_id
      and j.receiver_id=p_receiver_id for update;
  if not found then
    raise exception 'bridge_job_not_authorized' using errcode='42501';
  end if;
  if v_job.state in ('done','cancelled') then
    raise exception 'bridge_job_already_final' using errcode='23514';
  end if;
  update public.bridge_jobs
    set state='cancelled',session_binding_hex=null,
      updated_at=clock_timestamp()
    where id=p_job_id and receiver_id=p_receiver_id;
  return pg_catalog.jsonb_build_object(
    'jobId',v_job.id,'deviceId',v_job.device_id,'state','cancelled'
  );
end;
$$;

revoke all on function public.bridge_server_job_status(uuid,uuid)
  from public, anon, authenticated;
revoke all on function public.bridge_server_cancel_job(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.bridge_server_job_status(uuid,uuid)
  to service_role;
grant execute on function public.bridge_server_cancel_job(uuid,uuid)
  to service_role;

-- ===== 7/13: 20261106_bridge_job_revocation_fence.sql =====
-- ADDITIVE STAGING DRAFT. Apply AFTER bridge_jobs_staging,
-- bridge_job_admin_staging and the existing owner controls migrations.
-- A grant revocation / device switch OFF must atomically cancel pending and
-- dispatched jobs, permanently clearing their TX session binding.
--
-- Owner RPCs lock bridge_devices FIRST, then modify grants. Dispatch and
-- completion acquire the same device lock before taking a job lock.
-- Direct service_role updates outside that locking convention remain a
-- deployment hazard; this migration does not solve profile-status races.
-- This is a protected trigger helper, not a browser-callable RPC.
create or replace function public.bridge_cancel_jobs_on_consent_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and tg_table_name = 'bridge_grants' then
    if old.revoked_at is null and new.revoked_at is not null then
      update public.bridge_jobs
        set state = 'cancelled', session_binding_hex = null,
            updated_at = clock_timestamp()
        where device_id = new.device_id
          and receiver_id = new.receiver_id
          and state in ('queued', 'sent');
    end if;
  elsif tg_op = 'UPDATE' and tg_table_name = 'bridge_devices' then
    if old.bridge_enabled = true and new.bridge_enabled = false then
      update public.bridge_jobs
        set state = 'cancelled', session_binding_hex = null,
            updated_at = clock_timestamp()
        where device_id = new.id
          and state in ('queued', 'sent');
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.bridge_cancel_jobs_on_consent_change()
  from public, anon, authenticated;
drop trigger if exists bridge_cancel_jobs_on_grant_revoke
  on public.bridge_grants;
create trigger bridge_cancel_jobs_on_grant_revoke
  after update of revoked_at on public.bridge_grants
  for each row execute function public.bridge_cancel_jobs_on_consent_change();

drop trigger if exists bridge_cancel_jobs_on_owner_off
  on public.bridge_devices;
create trigger bridge_cancel_jobs_on_owner_off
  after update of bridge_enabled on public.bridge_devices
  for each row execute function public.bridge_cancel_jobs_on_consent_change();

-- This does not erase completed jobs or revoke TX credentials. A trusted
-- backend still needs shared session epochs/fencing and presence validation.

-- ===== 8/13: 20261106_bridge_tx_sessions_staging.sql =====
-- STAGING ONLY, ADDITIVE. Apply after bridge_device_verifiers and
-- bridge_job_revocation_fence. No external Supabase deployment.
-- TX possession MUST be established by the trusted backend with a fresh
-- verified device secret BEFORE invoking bridge_server_open_tx_session.
-- The database compares against its current device verifier and atomically
-- supersedes the previous session. Hashes are domain-separated by Node.
-- This is an authentication-state primitive, NOT a public TX API.

create table if not exists public.bridge_tx_sessions (
  device_id uuid primary key references public.bridge_devices(id) on delete cascade,
  token_hash_hex text not null check (token_hash_hex ~ '^[0-9a-f]{64}$'),
  verifier_hex text not null check (verifier_hex ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  check (expires_at > created_at)
);
create unique index if not exists bridge_tx_sessions_token_hash_idx
  on public.bridge_tx_sessions(token_hash_hex);
alter table public.bridge_tx_sessions enable row level security;
revoke all on public.bridge_tx_sessions from public, anon, authenticated;
-- No client policies. The server-role backend owns all TX session calls.

create or replace function public.bridge_server_open_tx_session(
  p_device_id uuid, p_token_hash_hex text, p_verifier_hex text
) returns timestamptz language plpgsql security invoker set search_path = ''
as $$
declare
  v_expires timestamptz;
begin
  if p_device_id is null or p_token_hash_hex is null or
     p_token_hash_hex !~ '^[0-9a-f]{64}$' or p_verifier_hex is null or
     p_verifier_hex !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_tx_session' using errcode='22023';
  end if;
  perform 1 from public.bridge_devices d
    where d.id=p_device_id and d.bridge_enabled=true for update;
  if not found then
    raise exception 'bridge_unavailable' using errcode='42501';
  end if;
  -- The backend must have authenticated the raw device secret; a hash
  -- supplied by an arbitrary caller is never sufficient proof of possession.
  if not exists(
    select 1 from public.bridge_device_verifiers v
      where v.device_id=p_device_id and v.verifier_hex=p_verifier_hex
  ) then
    raise exception 'bridge_tx_verifier_mismatch' using errcode='42501';
  end if;
  v_expires := clock_timestamp() + interval '5 minutes';
  insert into public.bridge_tx_sessions (
    device_id,token_hash_hex,verifier_hex,expires_at
  ) values (p_device_id,p_token_hash_hex,p_verifier_hex,v_expires)
  on conflict(device_id) do update
    set token_hash_hex=excluded.token_hash_hex,
        verifier_hex=excluded.verifier_hex,
        created_at=clock_timestamp(),expires_at=excluded.expires_at;
  -- Old delivered jobs must not complete under a newly opened session.
  update public.bridge_jobs
    set state='cancelled',session_binding_hex=null,
        updated_at=clock_timestamp()
    where device_id=p_device_id and state='sent';
  return v_expires;
end;
$$;

create or replace function public.bridge_server_assert_tx_session(
  p_device_id uuid, p_token_hash_hex text
) returns text language plpgsql security invoker set search_path = ''
as $$
declare
  v_hash text;
begin
  if p_device_id is null or p_token_hash_hex is null or
     p_token_hash_hex !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_tx_session' using errcode='22023';
  end if;
  perform 1 from public.bridge_devices d
    where d.id=p_device_id and d.bridge_enabled=true for update;
  if not found then
    raise exception 'bridge_unavailable' using errcode='42501';
  end if;
  select s.token_hash_hex into v_hash
    from public.bridge_tx_sessions s
    join public.bridge_device_verifiers v on v.device_id=s.device_id
      and v.verifier_hex=s.verifier_hex
    where s.device_id=p_device_id
      and s.token_hash_hex=p_token_hash_hex
      and s.expires_at>clock_timestamp()
    for update of s;
  if not found then
    raise exception 'bridge_tx_session_denied' using errcode='42501';
  end if;
  return v_hash;
end;
$$;

create or replace function public.bridge_server_close_tx_session(
  p_device_id uuid, p_token_hash_hex text
) returns boolean language plpgsql security invoker set search_path = ''
as $$
declare
  v_removed integer;
begin
  if p_device_id is null or p_token_hash_hex is null or
     p_token_hash_hex !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_tx_session' using errcode='22023';
  end if;
  perform 1 from public.bridge_devices d
    where d.id=p_device_id for update;
  if not found then return false; end if;
  delete from public.bridge_tx_sessions
    where device_id=p_device_id and token_hash_hex=p_token_hash_hex;
  get diagnostics v_removed = row_count;
  if v_removed=1 then
    update public.bridge_jobs
      set state='cancelled',session_binding_hex=null,
          updated_at=clock_timestamp()
      where device_id=p_device_id and state='sent'
        and session_binding_hex=p_token_hash_hex;
    return true;
  end if;
  return false;
end;
$$;

-- Owner OFF and verifier rotation/deletion invalidate sessions at commit.
-- Changing the grant receiver alone cancels their jobs, not TX device auth.
create or replace function public.bridge_drop_tx_session_on_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_table_name='bridge_devices' and tg_op='UPDATE' then
    if old.bridge_enabled=true and new.bridge_enabled=false then
      delete from public.bridge_tx_sessions where device_id=new.id;
    end if;
  elsif tg_table_name='bridge_device_verifiers' then
    if tg_op='DELETE' then
      delete from public.bridge_tx_sessions where device_id=old.device_id;
    elsif old.verifier_hex is distinct from new.verifier_hex
       or old.salt_hex is distinct from new.salt_hex then
      delete from public.bridge_tx_sessions where device_id=new.device_id;
    end if;
  end if;
  return coalesce(new,old);
end;
$$;
revoke all on function public.bridge_drop_tx_session_on_change()
  from public, anon, authenticated;
drop trigger if exists bridge_drop_session_owner_off on public.bridge_devices;
create trigger bridge_drop_session_owner_off
  after update of bridge_enabled on public.bridge_devices
  for each row execute function public.bridge_drop_tx_session_on_change();
drop trigger if exists bridge_drop_session_verifier_rotation
  on public.bridge_device_verifiers;
create trigger bridge_drop_session_verifier_rotation
  after update or delete on public.bridge_device_verifiers
  for each row execute function public.bridge_drop_tx_session_on_change();

revoke all on function public.bridge_server_open_tx_session(uuid,text,text)
  from public,anon,authenticated;
revoke all on function public.bridge_server_assert_tx_session(uuid,text)
  from public,anon,authenticated;
revoke all on function public.bridge_server_close_tx_session(uuid,text)
  from public,anon,authenticated;
grant execute on function public.bridge_server_open_tx_session(uuid,text,text)
  to service_role;
grant execute on function public.bridge_server_assert_tx_session(uuid,text)
  to service_role;
grant execute on function public.bridge_server_close_tx_session(uuid,text)
  to service_role;

-- ===== 9/13: 20261106_bridge_job_session_fence.sql =====
-- STAGING ONLY. Applied AFTER bridge_tx_sessions_staging.sql.
-- Replaces the legacy claim/completion definitions (no parallel old RPCs).
-- Shared TX session must be current and unexpired under the same device
-- row lock as each job mutation. All previous job permission checks remain.
-- Raw TX bearer NEVER enters PostgreSQL; trusted backend hashes it.
-- service_role must never expose these functions to browser/Android callers.

create or replace function public.bridge_server_claim_list(
  p_device_id uuid, p_session_binding_hex text
) returns uuid language plpgsql security invoker set search_path = ''
as $$
declare
  v_job_id uuid;
begin
  if p_device_id is null or p_session_binding_hex is null or
      p_session_binding_hex !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_bridge_session_binding' using errcode='22023';
  end if;
  perform 1 from public.bridge_devices d
    where d.id=p_device_id and d.bridge_enabled=true
    for update;
  if not found then
    raise exception 'bridge_unavailable' using errcode='42501';
  end if;
  -- Re-validate persistent session under the SAME device row lock as the
  -- dispatch or completion mutation. No separate preflight race.
  perform public.bridge_server_assert_tx_session(
    p_device_id,p_session_binding_hex
  );
  select j.id into v_job_id
  from public.bridge_jobs j
  join public.bridge_grants g
    on g.device_id=j.device_id and g.receiver_id=j.receiver_id
  join public.profiles p on p.id=j.receiver_id
  where j.device_id=p_device_id and j.state='queued'
    and j.expires_at > clock_timestamp() and g.revoked_at is null
    and p.role='admin' and p.status='approved'
  order by j.created_at, j.id
  limit 1
  for update of j;
  if v_job_id is null then return null; end if;

  update public.bridge_jobs set
    state='sent',session_binding_hex=p_session_binding_hex,
    updated_at=clock_timestamp()
  where id=v_job_id;
  return v_job_id;
end;
$$;

create or replace function public.bridge_server_complete_list(
  p_job_id uuid, p_device_id uuid, p_session_binding_hex text
) returns boolean language plpgsql security invoker set search_path = ''
as $$
declare
  v_job public.bridge_jobs%rowtype;
begin
  if p_job_id is null or p_device_id is null or
      p_session_binding_hex is null or
      p_session_binding_hex !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_bridge_request' using errcode='22023';
  end if;
  perform 1 from public.bridge_devices d
    where d.id=p_device_id and d.bridge_enabled=true
    for update;
  if not found then
    raise exception 'bridge_unavailable' using errcode='42501';
  end if;
  -- Re-validate persistent session under the SAME device row lock as the
  -- dispatch or completion mutation. No separate preflight race.
  perform public.bridge_server_assert_tx_session(
    p_device_id,p_session_binding_hex
  );
  select * into v_job from public.bridge_jobs j
    where j.id=p_job_id and j.device_id=p_device_id
    for update;
  if not found or v_job.state <> 'sent' or
      v_job.expires_at <= clock_timestamp() or
      v_job.session_binding_hex is distinct from p_session_binding_hex then
    raise exception 'bridge_job_not_authorized' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.bridge_grants g
      join public.profiles p on p.id=g.receiver_id
      where g.device_id=v_job.device_id and g.receiver_id=v_job.receiver_id
        and g.revoked_at is null and p.role='admin' and p.status='approved'
  ) then
    raise exception 'bridge_authority_denied' using errcode='42501';
  end if;
  update public.bridge_jobs set
    state='done',updated_at=clock_timestamp()
    where id=p_job_id;
  return true;
end;
$$;

-- CREATE OR REPLACE preserves existing EXECUTE privileges; explicitly
-- constrain them again for reviewability and future migration safety.
revoke all on function public.bridge_server_claim_list(uuid,text)
  from public,anon,authenticated;
revoke all on function public.bridge_server_complete_list(uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.bridge_server_claim_list(uuid,text)
  to service_role;
grant execute on function public.bridge_server_complete_list(uuid,uuid,text)
  to service_role;

-- ===== 10/13: 20261108_bridge_folder_catalog_staging.sql =====
-- BRIDGE FILE CATALOGUE, EXPERIMENTAL STAGING ONLY.
-- Apply solely after all existing Bridge migrations, on a disposable TEST DB.
-- No changes to FreePT production or existing chat/storage tables.
-- Stores at most one bounded, owner-selected folder listing per authenticated
-- TX job. No filesystem paths, content URIs, raw TX secrets or file bytes.
-- The server MUST verify the TX identity and active session before calling
-- bridge_server_complete_folder_page. Browser clients cannot execute it.
create table if not exists public.bridge_folder_pages (
  job_id uuid primary key references public.bridge_jobs(id) on delete cascade,
  entries jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  check (jsonb_typeof(entries) = 'array'),
  check (pg_catalog.jsonb_array_length(entries) <= 100)
);
alter table public.bridge_folder_pages enable row level security;
revoke all on public.bridge_folder_pages from public, anon, authenticated;

create or replace function public.bridge_server_complete_folder_page(
  p_job_id uuid, p_device_id uuid, p_session_binding_hex text,
  p_entries jsonb
) returns boolean
language plpgsql security invoker set search_path = ''
as $$
declare
  v_job public.bridge_jobs%rowtype;
  v_item jsonb;
  v_name text;
  v_handle text;
  v_mime text;
  v_size bigint;
begin
  if p_job_id is null or p_device_id is null or
     p_session_binding_hex is null or
     p_session_binding_hex !~ '^[0-9a-f]{64}$' or
     p_entries is null or jsonb_typeof(p_entries) <> 'array' or
     jsonb_array_length(p_entries)>100 or
     pg_catalog.octet_length(p_entries::text)>32768 then
    raise exception 'bridge_file_page_invalid' using errcode='22023';
  end if;
  for v_item in select value from pg_catalog.jsonb_array_elements(p_entries) loop
    if jsonb_typeof(v_item)<>'object' or
       (select count(*) from pg_catalog.jsonb_object_keys(v_item))<>5 or
       not(v_item ?& array['handle','name','directory','size','mime']) or
       jsonb_typeof(v_item->'handle')<>'string' or
       jsonb_typeof(v_item->'name')<>'string' or
       jsonb_typeof(v_item->'directory')<>'boolean' or
       jsonb_typeof(v_item->'size')<>'number' or
       jsonb_typeof(v_item->'mime')<>'string' then
      raise exception 'bridge_file_page_invalid' using errcode='22023';
    end if;
    v_handle:=v_item->>'handle';
    v_name:=v_item->>'name';
    v_mime:=v_item->>'mime';
    if v_handle !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or
       char_length(v_name) not between 1 and 255 or
       v_name in ('.','..') or
       v_name ~ '[/\\[:cntrl:]]' or
       char_length(v_mime)>160 or
       (v_item->>'size') !~ '^-?[0-9]+$' then
      raise exception 'bridge_file_page_invalid' using errcode='22023';
    end if;
    begin
      v_size:=(v_item->>'size')::bigint;
    exception when numeric_value_out_of_range then
      raise exception 'bridge_file_page_invalid' using errcode='22023';
    end;
    if v_size < -1 or v_size > 1099511627776 then
      raise exception 'bridge_file_page_invalid' using errcode='22023';
    end if;
  end loop;
  -- Same lock ordering as claim, completion and owner revocation:
  -- first device, then job. Both grant and TX session are checked after lock.
  perform 1 from public.bridge_devices d
    where d.id=p_device_id and d.bridge_enabled=true for update;
  if not found then
    raise exception 'bridge_authority_denied' using errcode='42501';
  end if;
  perform public.bridge_server_assert_tx_session(
    p_device_id,p_session_binding_hex
  );
  select * into v_job from public.bridge_jobs j
    where j.id=p_job_id and j.device_id=p_device_id for update;
  if not found or v_job.operation<>'list' or v_job.state<>'sent' or
     v_job.expires_at<=clock_timestamp() or
     v_job.session_binding_hex is distinct from p_session_binding_hex then
    raise exception 'bridge_job_not_authorized' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.bridge_grants g
    join public.profiles p on p.id=g.receiver_id
    where g.device_id=v_job.device_id and
          g.receiver_id=v_job.receiver_id and g.revoked_at is null and
          p.role='admin' and p.status='approved'
  ) then
    raise exception 'bridge_authority_denied' using errcode='42501';
  end if;
  insert into public.bridge_folder_pages(job_id,entries)
    values(p_job_id,p_entries);
  update public.bridge_jobs
    set state='done',updated_at=clock_timestamp() where id=p_job_id;
  return true;
end;
$$;

create or replace function public.bridge_server_read_folder_page(
  p_job_id uuid,p_receiver_id uuid
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_job public.bridge_jobs%rowtype;
  v_device_id uuid;
  v_entries jsonb;
begin
  if p_job_id is null or p_receiver_id is null then
    raise exception 'bridge_invalid_request' using errcode='22023';
  end if;
  select j.device_id into v_device_id from public.bridge_jobs j
    where j.id=p_job_id and j.receiver_id=p_receiver_id;
  if not found then
    raise exception 'bridge_job_not_authorized' using errcode='42501';
  end if;
  perform 1 from public.bridge_devices d
    where d.id=v_device_id and d.bridge_enabled=true for share;
  if not found then
    raise exception 'bridge_authority_denied' using errcode='42501';
  end if;
  select * into v_job from public.bridge_jobs j
    where j.id=p_job_id and j.receiver_id=p_receiver_id;
  if not found or v_job.state<>'done' or
     not exists (
       select 1 from public.bridge_grants g
       join public.profiles p on p.id=g.receiver_id
       where g.device_id=v_job.device_id and
             g.receiver_id=p_receiver_id and g.revoked_at is null and
             p.role='admin' and p.status='approved'
     ) then
    raise exception 'bridge_job_not_authorized' using errcode='42501';
  end if;
  select r.entries into v_entries from public.bridge_folder_pages r
    where r.job_id=p_job_id;
  if not found then
    raise exception 'bridge_file_page_missing' using errcode='42501';
  end if;
  return v_entries;
end;
$$;
revoke all on function public.bridge_server_complete_folder_page(uuid,uuid,text,jsonb)
  from public,anon,authenticated;
revoke all on function public.bridge_server_read_folder_page(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.bridge_server_complete_folder_page(uuid,uuid,text,jsonb)
  to service_role;
grant execute on function public.bridge_server_read_folder_page(uuid,uuid)
  to service_role;

-- ===== 11/13: 20261108_bridge_read_chunks_staging.sql =====
-- Isolated Bridge read-chunk staging. Applies AFTER folder catalog and session fence.
-- Extends the EXISTING queue; no production data, messages or storage touched.
-- Commit only to a disposable Bridge test database after checks pass.
alter table public.bridge_jobs drop constraint bridge_jobs_operation_check;
alter table public.bridge_jobs add constraint bridge_jobs_operation_check
  check (operation in ('list','read'));

create table public.bridge_read_requests (
  job_id uuid primary key references public.bridge_jobs(id) on delete cascade,
  handle uuid not null,
  byte_offset bigint not null check(byte_offset>=0 and byte_offset<=1099511627776),
  byte_length integer not null check(byte_length between 1 and 32768)
);
create table public.bridge_read_results (
  job_id uuid primary key references public.bridge_jobs(id) on delete cascade,
  chunk jsonb not null
);
alter table public.bridge_read_requests enable row level security;
alter table public.bridge_read_results enable row level security;
revoke all on public.bridge_read_requests from public,anon,authenticated;
revoke all on public.bridge_read_results from public,anon,authenticated;

-- Prevent legacy list RPCs from claiming/completing read requests.
create or replace function public.bridge_server_claim_list(
  p_device_id uuid, p_session_binding_hex text
) returns uuid language plpgsql security invoker set search_path = ''
as $$
declare
  v_job_id uuid;
begin
  if p_device_id is null or p_session_binding_hex is null or
      p_session_binding_hex !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_bridge_session_binding' using errcode='22023';
  end if;
  perform 1 from public.bridge_devices d
    where d.id=p_device_id and d.bridge_enabled=true
    for update;
  if not found then
    raise exception 'bridge_unavailable' using errcode='42501';
  end if;
  -- Re-validate persistent session under the SAME device row lock as the
  -- dispatch or completion mutation. No separate preflight race.
  perform public.bridge_server_assert_tx_session(
    p_device_id,p_session_binding_hex
  );
  select j.id into v_job_id
  from public.bridge_jobs j
  join public.bridge_grants g
    on g.device_id=j.device_id and g.receiver_id=j.receiver_id
  join public.profiles p on p.id=j.receiver_id
  where j.device_id=p_device_id and j.operation='list' and j.state='queued'
    and j.expires_at > clock_timestamp() and g.revoked_at is null
    and p.role='admin' and p.status='approved'
  order by j.created_at, j.id
  limit 1
  for update of j;
  if v_job_id is null then return null; end if;

  update public.bridge_jobs set
    state='sent',session_binding_hex=p_session_binding_hex,
    updated_at=clock_timestamp()
  where id=v_job_id;
  return v_job_id;
end;
$$;

create or replace function public.bridge_server_complete_list(
  p_job_id uuid, p_device_id uuid, p_session_binding_hex text
) returns boolean language plpgsql security invoker set search_path = ''
as $$
declare
  v_job public.bridge_jobs%rowtype;
begin
  if p_job_id is null or p_device_id is null or
      p_session_binding_hex is null or
      p_session_binding_hex !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_bridge_request' using errcode='22023';
  end if;
  perform 1 from public.bridge_devices d
    where d.id=p_device_id and d.bridge_enabled=true
    for update;
  if not found then
    raise exception 'bridge_unavailable' using errcode='42501';
  end if;
  -- Re-validate persistent session under the SAME device row lock as the
  -- dispatch or completion mutation. No separate preflight race.
  perform public.bridge_server_assert_tx_session(
    p_device_id,p_session_binding_hex
  );
  select * into v_job from public.bridge_jobs j
    where j.id=p_job_id and j.device_id=p_device_id
    for update;
  if not found or v_job.operation <> 'list' or v_job.state <> 'sent' or
      v_job.expires_at <= clock_timestamp() or
      v_job.session_binding_hex is distinct from p_session_binding_hex then
    raise exception 'bridge_job_not_authorized' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.bridge_grants g
      join public.profiles p on p.id=g.receiver_id
      where g.device_id=v_job.device_id and g.receiver_id=v_job.receiver_id
        and g.revoked_at is null and p.role='admin' and p.status='approved'
  ) then
    raise exception 'bridge_authority_denied' using errcode='42501';
  end if;
  update public.bridge_jobs set
    state='done',updated_at=clock_timestamp()
    where id=p_job_id;
  return true;
end;
$$;

-- CREATE OR REPLACE preserves existing EXECUTE privileges; explicitly
-- constrain them again for reviewability and future migration safety.
revoke all on function public.bridge_server_claim_list(uuid,text)
  from public,anon,authenticated;
revoke all on function public.bridge_server_complete_list(uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.bridge_server_claim_list(uuid,text)
  to service_role;
grant execute on function public.bridge_server_complete_list(uuid,uuid,text)
  to service_role;


create function public.bridge_server_enqueue_read(
  p_job_id uuid,p_device_id uuid,p_receiver_id uuid,
  p_handle uuid,p_offset bigint,p_length integer
) returns uuid language plpgsql security invoker set search_path=''
as $$
begin
  if p_job_id is null or p_device_id is null or p_receiver_id is null or
     p_handle is null or p_offset is null or p_offset<0 or
     p_length is null or p_length not between 1 and 32768 then
    raise exception 'bridge_read_invalid' using errcode='22023';
  end if;
  perform 1 from public.bridge_devices d where d.id=p_device_id
    and d.bridge_enabled=true for update;
  if not found then raise exception 'bridge_read_denied' using errcode='42501'; end if;
  if not exists (
    select 1 from public.bridge_grants g
    join public.profiles p on p.id=g.receiver_id
    where g.device_id=p_device_id and g.receiver_id=p_receiver_id
      and g.revoked_at is null and p.role='admin' and p.status='approved'
  ) then raise exception 'bridge_read_denied' using errcode='42501'; end if;
  -- Only file handles from a fresh, completed, same-device/same-receiver
  -- listing may be used. No arbitrary URI/path is ever accepted here.
  if not exists (
    select 1 from public.bridge_folder_pages f
    join public.bridge_jobs j on j.id=f.job_id
    cross join lateral jsonb_array_elements(f.entries) as e(entry)
    where j.device_id=p_device_id and j.receiver_id=p_receiver_id
      and j.operation='list' and j.state='done'
      and j.expires_at>clock_timestamp()
      and e.entry->>'handle'=p_handle::text
      and e.entry->>'directory'='false'
      and (e.entry->>'size')::bigint>=p_offset+p_length
  ) then raise exception 'bridge_read_handle_denied' using errcode='42501'; end if;
  insert into public.bridge_jobs(id,device_id,receiver_id,operation,state,expires_at)
    values(p_job_id,p_device_id,p_receiver_id,'read','queued',
      clock_timestamp()+interval '60 seconds');
  insert into public.bridge_read_requests(job_id,handle,byte_offset,byte_length)
    values(p_job_id,p_handle,p_offset,p_length);
  return p_job_id;
end;
$$;

create function public.bridge_server_claim_read(
  p_device_id uuid,p_session_binding_hex text
) returns jsonb language plpgsql security invoker set search_path=''
as $$
declare v_job uuid; v_request public.bridge_read_requests%rowtype;
begin
  if p_device_id is null or p_session_binding_hex is null or
     p_session_binding_hex !~ '^[0-9a-f]{64}$' then
    raise exception 'bridge_read_invalid' using errcode='22023';
  end if;
  perform 1 from public.bridge_devices d
    where d.id=p_device_id and d.bridge_enabled=true for update;
  if not found then raise exception 'bridge_read_denied' using errcode='42501'; end if;
  perform public.bridge_server_assert_tx_session(p_device_id,p_session_binding_hex);
  select j.id into v_job from public.bridge_jobs j
    join public.bridge_grants g on g.device_id=j.device_id and g.receiver_id=j.receiver_id
    join public.profiles p on p.id=j.receiver_id
    where j.device_id=p_device_id and j.operation='read' and j.state='queued'
      and j.expires_at>clock_timestamp()
      and g.revoked_at is null and p.role='admin' and p.status='approved'
    order by j.created_at,j.id limit 1 for update of j;
  if v_job is null then return null; end if;
  select * into strict v_request from public.bridge_read_requests where job_id=v_job;
  update public.bridge_jobs set state='sent',session_binding_hex=p_session_binding_hex,
    updated_at=clock_timestamp() where id=v_job;
  return jsonb_build_object('jobId',v_job,'deviceId',p_device_id,
    'operation','read','state','sent','handle',v_request.handle,
    'offset',v_request.byte_offset,'length',v_request.byte_length);
end;
$$;

create function public.bridge_server_complete_read(
  p_job_id uuid,p_device_id uuid,p_session_binding_hex text,p_chunk jsonb
) returns boolean language plpgsql security invoker set search_path=''
as $$
declare v_job public.bridge_jobs%rowtype;
        v_request public.bridge_read_requests%rowtype;
        v_data text; v_count integer;
begin
  if p_job_id is null or p_device_id is null or
     p_session_binding_hex is null or p_session_binding_hex !~ '^[0-9a-f]{64}$' or
     p_chunk is null or jsonb_typeof(p_chunk)<>'object' or
     (select count(*) from jsonb_object_keys(p_chunk))<>3 or
     not(p_chunk ?& array['base64','bytesRead','eof']) or
     jsonb_typeof(p_chunk->'base64')<>'string' or
     jsonb_typeof(p_chunk->'bytesRead')<>'number' or
     jsonb_typeof(p_chunk->'eof')<>'boolean' then
    raise exception 'bridge_chunk_invalid' using errcode='22023';
  end if;
  v_data:=p_chunk->>'base64';
  if v_data !~ '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$'
     or length(v_data)>43692 or
     (p_chunk->>'bytesRead') !~ '^[0-9]+$' then
    raise exception 'bridge_chunk_invalid' using errcode='22023';
  end if;
  begin
    v_count:=(p_chunk->>'bytesRead')::integer;
    if octet_length(decode(v_data,'base64'))<>v_count or
       encode(decode(v_data,'base64'),'base64')<>v_data then
      raise exception 'bridge_chunk_invalid' using errcode='22023';
    end if;
  exception when numeric_value_out_of_range or invalid_text_representation then
    raise exception 'bridge_chunk_invalid' using errcode='22023';
  end;
  perform 1 from public.bridge_devices d where d.id=p_device_id
    and d.bridge_enabled=true for update;
  if not found then raise exception 'bridge_read_denied' using errcode='42501'; end if;
  perform public.bridge_server_assert_tx_session(p_device_id,p_session_binding_hex);
  select * into v_job from public.bridge_jobs j where j.id=p_job_id
    and j.device_id=p_device_id for update;
  if not found or v_job.operation<>'read' or v_job.state<>'sent' or
     v_job.expires_at<=clock_timestamp() or
     v_job.session_binding_hex is distinct from p_session_binding_hex then
    raise exception 'bridge_read_denied' using errcode='42501';
  end if;
  if not exists(select 1 from public.bridge_grants g
    join public.profiles p on p.id=g.receiver_id
    where g.device_id=p_device_id and g.receiver_id=v_job.receiver_id
      and g.revoked_at is null and p.role='admin' and p.status='approved')
  then raise exception 'bridge_read_denied' using errcode='42501'; end if;
  select * into strict v_request from public.bridge_read_requests where job_id=p_job_id;
  if v_count<>v_request.byte_length then
    raise exception 'bridge_chunk_truncated' using errcode='22023';
  end if;
  insert into public.bridge_read_results(job_id,chunk) values(p_job_id,p_chunk);
  update public.bridge_jobs set state='done',updated_at=clock_timestamp() where id=p_job_id;
  return true;
end;
$$;

create function public.bridge_server_read_chunk(
  p_job_id uuid,p_receiver_id uuid
) returns jsonb language plpgsql security invoker set search_path=''
as $$
declare v_job public.bridge_jobs%rowtype; v_device_id uuid; v_chunk jsonb;
begin
  if p_job_id is null or p_receiver_id is null then
    raise exception 'bridge_read_invalid' using errcode='22023';
  end if;
  select j.device_id into v_device_id from public.bridge_jobs j
    where j.id=p_job_id and j.receiver_id=p_receiver_id;
  if not found then raise exception 'bridge_read_denied' using errcode='42501'; end if;
  perform 1 from public.bridge_devices d
    where d.id=v_device_id and d.bridge_enabled=true for share;
  if not found then raise exception 'bridge_read_denied' using errcode='42501'; end if;
  select * into v_job from public.bridge_jobs j where j.id=p_job_id
    and j.receiver_id=p_receiver_id;
  if not found or v_job.operation<>'read' or v_job.state<>'done' or
     v_job.expires_at<=clock_timestamp() or
     not exists(select 1 from public.bridge_grants g
       join public.profiles p on p.id=g.receiver_id
       where g.device_id=v_job.device_id and g.receiver_id=p_receiver_id
         and g.revoked_at is null and p.role='admin' and p.status='approved')
  then raise exception 'bridge_read_denied' using errcode='42501'; end if;
  select r.chunk into v_chunk from public.bridge_read_results r where r.job_id=p_job_id;
  if not found then raise exception 'bridge_read_denied' using errcode='42501'; end if;
  return v_chunk;
end;
$$;

revoke all on public.bridge_read_requests,public.bridge_read_results from public,anon,authenticated;
revoke all on function public.bridge_server_enqueue_read(uuid,uuid,uuid,uuid,bigint,integer)
  from public,anon,authenticated;
revoke all on function public.bridge_server_claim_read(uuid,text)
  from public,anon,authenticated;
revoke all on function public.bridge_server_complete_read(uuid,uuid,text,jsonb)
  from public,anon,authenticated;
revoke all on function public.bridge_server_read_chunk(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.bridge_server_enqueue_read(uuid,uuid,uuid,uuid,bigint,integer)
  to service_role;
grant execute on function public.bridge_server_claim_read(uuid,text) to service_role;
grant execute on function public.bridge_server_complete_read(uuid,uuid,text,jsonb) to service_role;
grant execute on function public.bridge_server_read_chunk(uuid,uuid) to service_role;

-- ===== 12/13: 20261108_bridge_browse_staging.sql =====
-- Bridge directory browsing on a disposable staging database ONLY.
-- Install after read-chunk staging; extends the SAME persisted job queue.
-- All handle authorization is from prior completed, grant-scoped catalogues.
alter table public.bridge_jobs drop constraint bridge_jobs_operation_check;
alter table public.bridge_jobs add constraint bridge_jobs_operation_check
  check(operation in ('list','read','browse'));
alter table public.bridge_folder_pages add column next_offset integer not null default -1
  check(next_offset=-1 or next_offset between 100 and 10000);

create table public.bridge_browse_requests(
 job_id uuid primary key references public.bridge_jobs(id) on delete cascade,
 parent_handle text not null,
 page_offset integer not null check(page_offset between 0 and 10000),
 check(parent_handle='root' or parent_handle ~*
 '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
);
alter table public.bridge_browse_requests enable row level security;
revoke all on public.bridge_browse_requests from public,anon,authenticated;

create function public.bridge_server_enqueue_browse(
 p_job_id uuid,p_device_id uuid,p_receiver_id uuid,
 p_handle text,p_offset integer
) returns uuid language plpgsql security invoker set search_path=''
as $$
begin
 if p_job_id is null or p_device_id is null or p_receiver_id is null or
    p_offset is null or p_offset<0 or p_offset>10000 or
    p_handle is null or not(p_handle='root' or p_handle ~*
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') then
   raise exception 'bridge_browse_invalid' using errcode='22023';
 end if;
 perform 1 from public.bridge_devices d where d.id=p_device_id
   and d.bridge_enabled=true for update;
 if not found then raise exception 'bridge_browse_denied' using errcode='42501'; end if;
 if not exists(
   select 1 from public.bridge_grants g
   join public.profiles p on p.id=g.receiver_id
   where g.device_id=p_device_id and g.receiver_id=p_receiver_id
     and g.revoked_at is null and p.role='admin' and p.status='approved'
 ) then raise exception 'bridge_browse_denied' using errcode='42501'; end if;
 if p_handle<>'root' and not exists(
   select 1 from public.bridge_folder_pages f
   join public.bridge_jobs j on j.id=f.job_id
   cross join lateral jsonb_array_elements(f.entries) as e(entry)
   where j.device_id=p_device_id and j.receiver_id=p_receiver_id
     and j.operation in ('list','browse') and j.state='done'
     and j.expires_at>clock_timestamp()
     and e.entry->>'handle'=p_handle
     and e.entry->>'directory'='true'
 ) then raise exception 'bridge_browse_handle_denied' using errcode='42501'; end if;
 insert into public.bridge_jobs(id,device_id,receiver_id,operation,state,expires_at)
   values(p_job_id,p_device_id,p_receiver_id,'browse','queued',
     clock_timestamp()+interval '60 seconds');
 insert into public.bridge_browse_requests(job_id,parent_handle,page_offset)
   values(p_job_id,p_handle,p_offset);
 return p_job_id;
end;
$$;

create function public.bridge_server_claim_browse(
 p_device_id uuid,p_session_binding_hex text
) returns jsonb language plpgsql security invoker set search_path=''
as $$
declare v_job uuid;v_browse public.bridge_browse_requests%rowtype;
begin
 if p_device_id is null or p_session_binding_hex is null or
    p_session_binding_hex !~ '^[0-9a-f]{64}$' then
    raise exception 'bridge_browse_invalid' using errcode='22023'; end if;
 perform 1 from public.bridge_devices d where d.id=p_device_id
   and d.bridge_enabled=true for update;
 if not found then raise exception 'bridge_browse_denied' using errcode='42501'; end if;
 perform public.bridge_server_assert_tx_session(p_device_id,p_session_binding_hex);
 select j.id into v_job from public.bridge_jobs j
   join public.bridge_grants g on g.device_id=j.device_id and g.receiver_id=j.receiver_id
   join public.profiles p on p.id=j.receiver_id
   where j.device_id=p_device_id and j.operation='browse' and j.state='queued'
     and j.expires_at>clock_timestamp() and g.revoked_at is null
     and p.role='admin' and p.status='approved'
   order by j.created_at,j.id limit 1 for update of j;
 if v_job is null then return null; end if;
 select * into strict v_browse from public.bridge_browse_requests where job_id=v_job;
 update public.bridge_jobs set state='sent',session_binding_hex=p_session_binding_hex,
   updated_at=clock_timestamp() where id=v_job;
 return jsonb_build_object('jobId',v_job,'deviceId',p_device_id,
   'operation','browse','state','sent','handle',v_browse.parent_handle,
   'offset',v_browse.page_offset);
end;
$$;

create or replace function public.bridge_server_complete_browse_page(
  p_job_id uuid, p_device_id uuid, p_session_binding_hex text,
  p_entries jsonb, p_next_offset integer
) returns boolean
language plpgsql security invoker set search_path = ''
as $$
declare
  v_job public.bridge_jobs%rowtype;
  v_item jsonb;
  v_name text;
  v_handle text;
  v_mime text;
  v_size bigint;
begin
  if p_job_id is null or p_device_id is null or
     p_session_binding_hex is null or
     p_session_binding_hex !~ '^[0-9a-f]{64}$' or
     p_next_offset is null or p_next_offset < -1 or p_next_offset > 10000 or
     p_entries is null or jsonb_typeof(p_entries) <> 'array' or
     jsonb_array_length(p_entries)>100 or
     pg_catalog.octet_length(p_entries::text)>32768 then
    raise exception 'bridge_file_page_invalid' using errcode='22023';
  end if;
  if p_next_offset<>-1 and jsonb_array_length(p_entries)<>100 then
    raise exception 'bridge_file_page_invalid' using errcode='22023';
  end if;
  for v_item in select value from pg_catalog.jsonb_array_elements(p_entries) loop
    if jsonb_typeof(v_item)<>'object' or
       (select count(*) from pg_catalog.jsonb_object_keys(v_item))<>5 or
       not(v_item ?& array['handle','name','directory','size','mime']) or
       jsonb_typeof(v_item->'handle')<>'string' or
       jsonb_typeof(v_item->'name')<>'string' or
       jsonb_typeof(v_item->'directory')<>'boolean' or
       jsonb_typeof(v_item->'size')<>'number' or
       jsonb_typeof(v_item->'mime')<>'string' then
      raise exception 'bridge_file_page_invalid' using errcode='22023';
    end if;
    v_handle:=v_item->>'handle';
    v_name:=v_item->>'name';
    v_mime:=v_item->>'mime';
    if v_handle !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or
       char_length(v_name) not between 1 and 255 or
       v_name in ('.','..') or
       v_name ~ '[/\\[:cntrl:]]' or
       char_length(v_mime)>160 or
       (v_item->>'size') !~ '^-?[0-9]+$' then
      raise exception 'bridge_file_page_invalid' using errcode='22023';
    end if;
    begin
      v_size:=(v_item->>'size')::bigint;
    exception when numeric_value_out_of_range then
      raise exception 'bridge_file_page_invalid' using errcode='22023';
    end;
    if v_size < -1 or v_size > 1099511627776 then
      raise exception 'bridge_file_page_invalid' using errcode='22023';
    end if;
  end loop;
  -- Same lock ordering as claim, completion and owner revocation:
  -- first device, then job. Both grant and TX session are checked after lock.
  perform 1 from public.bridge_devices d
    where d.id=p_device_id and d.bridge_enabled=true for update;
  if not found then
    raise exception 'bridge_authority_denied' using errcode='42501';
  end if;
  perform public.bridge_server_assert_tx_session(
    p_device_id,p_session_binding_hex
  );
  select * into v_job from public.bridge_jobs j
    where j.id=p_job_id and j.device_id=p_device_id for update;
  if not found or v_job.operation<>'browse' or v_job.state<>'sent' or
     v_job.expires_at<=clock_timestamp() or
     v_job.session_binding_hex is distinct from p_session_binding_hex then
    raise exception 'bridge_job_not_authorized' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.bridge_grants g
    join public.profiles p on p.id=g.receiver_id
    where g.device_id=v_job.device_id and
          g.receiver_id=v_job.receiver_id and g.revoked_at is null and
          p.role='admin' and p.status='approved'
  ) then
    raise exception 'bridge_authority_denied' using errcode='42501';
  end if;
  if p_next_offset<>-1 and not exists(
    select 1 from public.bridge_browse_requests r
    where r.job_id=p_job_id and r.page_offset+100=p_next_offset
  ) then
    raise exception 'bridge_file_page_invalid' using errcode='22023';
  end if;
  insert into public.bridge_folder_pages(job_id,entries,next_offset)
    values(p_job_id,p_entries,p_next_offset);
  -- Persist completed, authenticated metadata for the remaining consented
  -- transfer session; queued/unclaimed jobs still expire after 60 seconds.
  update public.bridge_jobs
    set state='done',expires_at=clock_timestamp()+interval '5 minutes',
        updated_at=clock_timestamp() where id=p_job_id;
  return true;
end;
$$;


create function public.bridge_server_read_browse_page(
 p_job_id uuid,p_receiver_id uuid
) returns jsonb language plpgsql security invoker set search_path=''
as $$
declare v_job public.bridge_jobs%rowtype;v_device uuid;v_page public.bridge_folder_pages%rowtype;
begin
 if p_job_id is null or p_receiver_id is null then
   raise exception 'bridge_browse_invalid' using errcode='22023'; end if;
 select j.device_id into v_device from public.bridge_jobs j
   where j.id=p_job_id and j.receiver_id=p_receiver_id;
 if not found then raise exception 'bridge_browse_denied' using errcode='42501'; end if;
 perform 1 from public.bridge_devices d where d.id=v_device
   and d.bridge_enabled=true for share;
 if not found then raise exception 'bridge_browse_denied' using errcode='42501'; end if;
 select * into v_job from public.bridge_jobs j where j.id=p_job_id
   and j.receiver_id=p_receiver_id;
 if not found or v_job.operation<>'browse' or v_job.state<>'done' or
    v_job.expires_at<=clock_timestamp() or
    not exists(select 1 from public.bridge_grants g
      join public.profiles p on p.id=g.receiver_id
      where g.device_id=v_device and g.receiver_id=p_receiver_id
        and g.revoked_at is null and p.role='admin' and p.status='approved')
 then raise exception 'bridge_browse_denied' using errcode='42501'; end if;
 select * into v_page from public.bridge_folder_pages where job_id=p_job_id;
 if not found then raise exception 'bridge_browse_denied' using errcode='42501'; end if;
 return jsonb_build_object('entries',v_page.entries,'nextOffset',v_page.next_offset);
end;
$$;

-- Files discovered inside granted subfolders are readable with the same grant.
create or replace function public.bridge_server_enqueue_read(
  p_job_id uuid,p_device_id uuid,p_receiver_id uuid,
  p_handle uuid,p_offset bigint,p_length integer
) returns uuid language plpgsql security invoker set search_path=''
as $$
begin
  if p_job_id is null or p_device_id is null or p_receiver_id is null or
     p_handle is null or p_offset is null or p_offset<0 or
     p_length is null or p_length not between 1 and 32768 then
    raise exception 'bridge_read_invalid' using errcode='22023';
  end if;
  perform 1 from public.bridge_devices d where d.id=p_device_id
    and d.bridge_enabled=true for update;
  if not found then raise exception 'bridge_read_denied' using errcode='42501'; end if;
  if not exists (
    select 1 from public.bridge_grants g
    join public.profiles p on p.id=g.receiver_id
    where g.device_id=p_device_id and g.receiver_id=p_receiver_id
      and g.revoked_at is null and p.role='admin' and p.status='approved'
  ) then raise exception 'bridge_read_denied' using errcode='42501'; end if;
  -- Only file handles from a fresh, completed, same-device/same-receiver
  -- listing may be used. No arbitrary URI/path is ever accepted here.
  if not exists (
    select 1 from public.bridge_folder_pages f
    join public.bridge_jobs j on j.id=f.job_id
    cross join lateral jsonb_array_elements(f.entries) as e(entry)
    where j.device_id=p_device_id and j.receiver_id=p_receiver_id
      and j.operation in ('list','browse') and j.state='done'
      and j.expires_at>clock_timestamp()
      and e.entry->>'handle'=p_handle::text
      and e.entry->>'directory'='false'
      and (e.entry->>'size')::bigint>=p_offset+p_length
  ) then raise exception 'bridge_read_handle_denied' using errcode='42501'; end if;
  insert into public.bridge_jobs(id,device_id,receiver_id,operation,state,expires_at)
    values(p_job_id,p_device_id,p_receiver_id,'read','queued',
      clock_timestamp()+interval '60 seconds');
  insert into public.bridge_read_requests(job_id,handle,byte_offset,byte_length)
    values(p_job_id,p_handle,p_offset,p_length);
  return p_job_id;
end;
$$;


revoke all on function public.bridge_server_enqueue_browse(uuid,uuid,uuid,text,integer)
 from public,anon,authenticated;
revoke all on function public.bridge_server_claim_browse(uuid,text)
 from public,anon,authenticated;
revoke all on function public.bridge_server_complete_browse_page(uuid,uuid,text,jsonb,integer)
 from public,anon,authenticated;
revoke all on function public.bridge_server_read_browse_page(uuid,uuid)
 from public,anon,authenticated;
grant execute on function public.bridge_server_enqueue_browse(uuid,uuid,uuid,text,integer)
 to service_role;
grant execute on function public.bridge_server_claim_browse(uuid,text) to service_role;
grant execute on function public.bridge_server_complete_browse_page(uuid,uuid,text,jsonb,integer)
 to service_role;
grant execute on function public.bridge_server_read_browse_page(uuid,uuid) to service_role;

-- ===== 13/13: 20261108_bridge_device_enrollment_staging.sql =====
-- STAGING ONLY — install after Bridge foundation + verifiers + owner controls.
-- This is trusted-server-only device enrollment. Browser clients must never
-- invoke it; backend MUST validate Supabase Auth and derive p_owner_id itself.
-- A single transaction creates device and verifier together. The raw secret
-- never enters SQL, logs, tables or GitHub.
create or replace function public.bridge_server_enroll_device(
  p_device_id uuid, p_owner_id uuid, p_label text,
  p_salt_hex text, p_verifier_hex text
) returns uuid
language plpgsql security invoker set search_path = ''
as $$
begin
  if p_device_id is null or p_owner_id is null or
     p_label is null or char_length(p_label) not between 1 and 100 or
     p_label ~ '[[:cntrl:]]' or
     p_salt_hex is null or p_salt_hex !~ '^[0-9a-f]{32}$' or
     p_verifier_hex is null or p_verifier_hex !~ '^[0-9a-f]{64}$' then
    raise exception 'bridge_device_enrollment_invalid' using errcode='22023';
  end if;
  -- Locks the verified owner's profile and refuses a suspended/pending user.
  -- The caller identity must be independently verified by the trusted server.
  perform 1 from public.profiles p
    where p.id=p_owner_id and p.status='approved' for update;
  if not found then
    raise exception 'bridge_device_owner_denied' using errcode='42501';
  end if;
  -- Limit per owner to avoid an unbounded inventory; concurrent operations
  -- serialize on the owner's locked profile row.
  if (select count(*) from public.bridge_devices
      where owner_id=p_owner_id)>=5 then
    raise exception 'bridge_device_limit' using errcode='23514';
  end if;
  insert into public.bridge_devices
    (id,owner_id,label,bridge_enabled)
    values(p_device_id,p_owner_id,p_label,false);
  insert into public.bridge_device_verifiers
    (device_id,salt_hex,verifier_hex)
    values(p_device_id,p_salt_hex,p_verifier_hex);
  return p_device_id;
end;
$$;

-- Revocation of the device itself. Existing FK cascades clean up grants,
-- jobs, TX sessions and folder pages. Client may not invoke this privileged
-- operation: the server must verify owner identity on every request.
create or replace function public.bridge_server_delete_device(
  p_device_id uuid,p_owner_id uuid
) returns boolean
language plpgsql security invoker set search_path = ''
as $$
declare v_count integer;
begin
  if p_device_id is null or p_owner_id is null then
    raise exception 'bridge_device_invalid' using errcode='22023';
  end if;
  perform 1 from public.bridge_devices d
    where d.id=p_device_id and d.owner_id=p_owner_id for update;
  if not found then
    raise exception 'bridge_device_owner_denied' using errcode='42501';
  end if;
  delete from public.bridge_devices
    where id=p_device_id and owner_id=p_owner_id;
  get diagnostics v_count=row_count;
  return v_count=1;
end;
$$;
revoke all on function public.bridge_server_enroll_device(uuid,uuid,text,text,text)
  from public,anon,authenticated;
revoke all on function public.bridge_server_delete_device(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.bridge_server_enroll_device(uuid,uuid,text,text,text)
  to service_role;
grant execute on function public.bridge_server_delete_device(uuid,uuid)
  to service_role;

-- ===== 14/14: 20261109_bridge_family_activation_staging.sql =====
-- STAGING ONLY: the device owner explicitly approves one named FreePT
-- family administrator through a single guided action.
-- Never apply to FreePT production. Fail closed when no unique approved admin.
create or replace function public.bridge_owner_activate_family(p_device_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $
declare
  v_admins uuid[];
  v_receiver uuid;
begin
  if (select auth.uid()) is null
     or not (select public.freept_is_approved()) then
    raise exception 'bridge_owner_not_approved' using errcode='42501';
  end if;
  if p_device_id is null then
    raise exception 'bridge_invalid_device' using errcode='22023';
  end if;
  -- Lock owner device before altering either access state. The owner is
  -- derived from the authenticated session, never supplied by the client.
  perform 1 from public.bridge_devices d
    where d.id=p_device_id and d.owner_id=(select auth.uid())
    for update;
  if not found then
    raise exception 'bridge_owner_required' using errcode='42501';
  end if;
  select array_agg(p.id order by p.id) into v_admins
  from public.profiles p
  where p.role='admin' and p.status='approved';
  if coalesce(array_length(v_admins,1),0)<>1 then
    raise exception 'bridge_unique_admin_required' using errcode='42501';
  end if;
  v_receiver:=v_admins[1];
  insert into public.bridge_grants(device_id,receiver_id,approved_at,revoked_at)
  values(p_device_id,v_receiver,clock_timestamp(),null)
  on conflict(device_id,receiver_id) do update
    set approved_at=excluded.approved_at,revoked_at=null;
  update public.bridge_devices
    set bridge_enabled=true,updated_at=clock_timestamp()
    where id=p_device_id and owner_id=(select auth.uid());
  return v_receiver;
end;
$;
revoke all on function public.bridge_owner_activate_family(uuid) from public,anon;
grant execute on function public.bridge_owner_activate_family(uuid) to authenticated;


COMMIT;
-- CHECK (read only):
SELECT count(*) AS bridge_tables_installed
FROM information_schema.tables
WHERE table_schema='public' AND table_name LIKE 'bridge_%';
