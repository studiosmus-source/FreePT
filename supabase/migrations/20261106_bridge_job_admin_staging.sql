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
