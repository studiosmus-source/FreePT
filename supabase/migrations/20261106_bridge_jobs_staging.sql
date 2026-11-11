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
