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
