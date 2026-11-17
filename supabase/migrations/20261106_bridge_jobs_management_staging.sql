-- STAGING ONLY. Apply after 20261106_bridge_jobs_staging.sql.
-- Extend the existing persisted job queue, without a second job store.
-- Both functions are server-only: p_receiver_id MUST come from an independently
-- verified, approved admin identity, never from the user request body.

create or replace function public.bridge_server_job_status(
  p_job_id uuid, p_receiver_id uuid
) returns text language plpgsql security invoker set search_path = ''
as $$
declare
  v_device_id uuid;
  v_job public.bridge_jobs%rowtype;
begin
  if p_job_id is null or p_receiver_id is null then
    raise exception 'invalid_bridge_request' using errcode='22023';
  end if;

  -- Read the device identity only; do not disclose job existence to callers.
  select j.device_id into v_device_id from public.bridge_jobs j
    where j.id=p_job_id and j.receiver_id=p_receiver_id;
  if not found then
    raise exception 'bridge_job_not_authorized' using errcode='42501';
  end if;
  -- Share lock serializes with owner OFF/revocation device-row updates.
  perform 1 from public.bridge_devices d where d.id=v_device_id for share;
  if not found then
    raise exception 'bridge_job_not_authorized' using errcode='42501';
  end if;
  select * into v_job from public.bridge_jobs j
    where j.id=p_job_id and j.receiver_id=p_receiver_id;
  if not found or not exists(
    select 1 from public.bridge_grants g
      join public.profiles p on p.id=g.receiver_id
      where g.device_id=v_job.device_id and g.receiver_id=p_receiver_id
        and g.revoked_at is null and p.role='admin' and p.status='approved'
  ) then
    raise exception 'bridge_job_not_authorized' using errcode='42501';
  end if;
  if v_job.state in ('queued','sent') and v_job.expires_at<=clock_timestamp() then
    return 'expired';
  end if;
  return v_job.state;
end;
$$;

create or replace function public.bridge_server_cancel_job(
  p_job_id uuid, p_receiver_id uuid
) returns boolean language plpgsql security invoker set search_path = ''
as $$
declare
  v_device_id uuid;
  v_job public.bridge_jobs%rowtype;
begin
  if p_job_id is null or p_receiver_id is null then
    raise exception 'invalid_bridge_request' using errcode='22023';
  end if;
  select j.device_id into v_device_id from public.bridge_jobs j
    where j.id=p_job_id and j.receiver_id=p_receiver_id;
  if not found then
    raise exception 'bridge_job_not_authorized' using errcode='42501';
  end if;
  -- Use the exact lock order of claim/complete: device, then job.
  perform 1 from public.bridge_devices d where d.id=v_device_id for update;
  if not found then
    raise exception 'bridge_job_not_authorized' using errcode='42501';
  end if;
  select * into v_job from public.bridge_jobs j
    where j.id=p_job_id and j.receiver_id=p_receiver_id for update;
  if not found or not exists(
    select 1 from public.bridge_grants g
      join public.profiles p on p.id=g.receiver_id
      where g.device_id=v_job.device_id and g.receiver_id=p_receiver_id
        and g.revoked_at is null and p.role='admin' and p.status='approved'
  ) then
    raise exception 'bridge_job_not_authorized' using errcode='42501';
  end if;
  if v_job.state not in ('queued','sent') or v_job.expires_at<=clock_timestamp() then
    raise exception 'bridge_job_not_cancellable' using errcode='42501';
  end if;
  update public.bridge_jobs set state='cancelled', updated_at=clock_timestamp()
    where id=p_job_id;
  return true;
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
