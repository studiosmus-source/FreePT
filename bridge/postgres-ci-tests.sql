-- Real PostgreSQL CI assertions on disposable database only.
-- Loaded after bootstrap and all five isolated Bridge migrations.
\set ON_ERROR_STOP on
do $checks$
declare
  v_device uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  v_owner uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_admin uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  v_sent uuid := '11111111-1111-4111-8111-111111111111';
  v_denied uuid := '22222222-2222-4222-8222-222222222222';
  v_again uuid := '33333333-3333-4333-8333-333333333333';
  v_job uuid;
  v_ok boolean;
begin
  if not (select relrowsecurity from pg_class where oid='public.bridge_jobs'::regclass) then
    raise exception 'bridge_jobs RLS missing';
  end if;
  if has_table_privilege('authenticated','public.bridge_jobs','SELECT')
    or has_table_privilege('authenticated','public.bridge_jobs','INSERT')
    or has_table_privilege('authenticated','public.bridge_jobs','UPDATE')
    or has_table_privilege('authenticated','public.bridge_jobs','DELETE')
    or has_function_privilege('authenticated',
      'public.bridge_server_enqueue_list(uuid,uuid,uuid)','EXECUTE')
    or has_function_privilege('anon',
      'public.bridge_server_claim_list(uuid,text)','EXECUTE')
    or has_function_privilege('authenticated',
      'public.bridge_server_complete_list(uuid,uuid,text)','EXECUTE') then
    raise exception 'client can access restricted Bridge jobs';
  end if;
  if not has_function_privilege('service_role',
      'public.bridge_server_enqueue_list(uuid,uuid,uuid)','EXECUTE')
    or not has_function_privilege('service_role',
      'public.bridge_server_claim_list(uuid,text)','EXECUTE')
    or not has_function_privilege('service_role',
      'public.bridge_server_complete_list(uuid,uuid,text)','EXECUTE') then
    raise exception 'service_role cannot call job RPC';
  end if;

  insert into public.bridge_devices(id,owner_id,label)
    values(v_device,v_owner,'CI TX');
  perform set_config('request.jwt.claim.sub',v_owner::text,true);
  perform public.bridge_owner_grant(v_device,v_admin);
  perform public.bridge_owner_set_enabled(v_device,true);

  v_job:=public.bridge_server_enqueue_list(v_sent,v_device,v_admin);
  if v_job is distinct from v_sent then
    raise exception 'enqueue did not return job ID';
  end if;
  v_job:=public.bridge_server_claim_list(v_device,repeat('a',64));
  if v_job is distinct from v_sent then
    raise exception 'claim did not return oldest queued job';
  end if;
  begin
    perform public.bridge_server_complete_list(v_sent,v_device,repeat('b',64));
    raise exception 'wrong session binding accepted';
  exception when sqlstate '42501' then
    null;
  end;
  v_ok:=public.bridge_server_complete_list(v_sent,v_device,repeat('a',64));
  if not v_ok or (select state from public.bridge_jobs where id=v_sent)<>'done' then
    raise exception 'completion not persisted';
  end if;
  begin
    perform public.bridge_server_complete_list(v_sent,v_device,repeat('a',64));
    raise exception 'replay accepted';
  exception when sqlstate '42501' then
    null;
  end;

  perform public.bridge_server_enqueue_list(v_denied,v_device,v_admin);
  perform public.bridge_owner_revoke(v_device,v_admin);
  if public.bridge_server_claim_list(v_device,repeat('c',64)) is not null then
    raise exception 'revoked job dispatched';
  end if;
  begin
    perform public.bridge_server_enqueue_list(v_again,v_device,v_admin);
    raise exception 'revoked grant re-enqueued';
  exception when sqlstate '42501' then
    null;
  end;
  perform public.bridge_owner_grant(v_device,v_admin);
  perform public.bridge_server_enqueue_list(v_again,v_device,v_admin);
  perform public.bridge_owner_set_enabled(v_device,false);
  begin
    perform public.bridge_server_claim_list(v_device,repeat('d',64));
    raise exception 'owner-off claim accepted';
  exception when sqlstate '42501' then
    null;
  end;
  if (select bridge_enabled from public.bridge_devices where id=v_device) then
    raise exception 'owner-off flag missing';
  end if;
end
$checks$;
select 'bridge-postgres-contract-ok' as result;
