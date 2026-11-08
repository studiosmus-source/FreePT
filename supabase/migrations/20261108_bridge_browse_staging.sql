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
  insert into public.bridge_folder_pages(job_id,entries,next_offset)
    values(p_job_id,p_entries,p_next_offset);
  update public.bridge_jobs
    set state='done',updated_at=clock_timestamp() where id=p_job_id;
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
