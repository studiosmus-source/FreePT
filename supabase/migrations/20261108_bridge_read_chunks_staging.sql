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
