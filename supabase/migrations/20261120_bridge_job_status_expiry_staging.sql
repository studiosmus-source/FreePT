-- STAGING ONLY: upgrades existing installations without touching user data.
-- The queue's expires_at already controls TX claim; this only makes the
-- authenticated admin's status reflect an expired pending job.
-- Keep the same RPC signature, device/job lock order and service_role gate.
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
    'jobId',v_job.id,'deviceId',v_job.device_id,'state',
    case when v_job.state in ('queued','sent')
           and v_job.expires_at <= clock_timestamp()
      then 'expired' else v_job.state end
  );
end;
$$;

revoke all on function public.bridge_server_job_status(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.bridge_server_job_status(uuid,uuid)
  to service_role;
