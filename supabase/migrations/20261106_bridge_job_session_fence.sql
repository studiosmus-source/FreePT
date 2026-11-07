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
