-- Isolated PostgreSQL test of atomic, authorized Bridge folder catalogue.
\set ON_ERROR_STOP on
do $verify$
declare
  dev uuid := 'f1111111-1111-4111-8111-111111111111';
  owner_id uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  admin_id uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  stranger uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  job uuid := 'f2222222-2222-4222-8222-222222222222';
  other_job uuid := 'f3333333-3333-4333-8333-333333333333';
  binding text := repeat('d',64);
  verifier text := repeat('e',64);
  page jsonb;
begin
  if has_function_privilege('authenticated',
      'public.bridge_server_read_folder_page(uuid,uuid)','EXECUTE') or
     has_table_privilege('authenticated','public.bridge_folder_pages','SELECT') or
     not has_function_privilege('service_role',
      'public.bridge_server_complete_folder_page(uuid,uuid,text,jsonb)','EXECUTE') then
    raise exception 'folder catalogue privileges too broad';
  end if;

  insert into public.bridge_devices(id,owner_id,label)
    values(dev,owner_id,'Authorized folder test');
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  perform public.bridge_owner_grant(dev,admin_id);
  perform public.bridge_owner_set_enabled(dev,true);
  insert into public.bridge_device_verifiers(device_id,salt_hex,verifier_hex)
    values(dev,repeat('a',32),verifier);
  perform public.bridge_server_open_tx_session(dev,binding,verifier);
  perform public.bridge_server_enqueue_list(job,dev,admin_id);
  if public.bridge_server_claim_list(dev,binding) is distinct from job then
    raise exception 'folder job not dispatched';
  end if;

  page := jsonb_build_array(jsonb_build_object(
    'handle','f4444444-4444-4444-8444-444444444444',
    'name','Foto vacanza','directory',true,'size',-1,'mime',
    'vnd.android.document/directory'
  ));
  begin
    perform public.bridge_server_complete_folder_page(job,dev,repeat('b',64),page);
    raise exception 'wrong TX session accepted';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.bridge_server_complete_folder_page(job,dev,binding,
      '[{"handle":"f4444444-4444-4444-8444-444444444444","name":"../private","directory":true,"size":-1,"mime":"x"}]'::jsonb);
    raise exception 'unsafe filename accepted';
  exception when sqlstate '22023' then null;
  end;
  if public.bridge_server_complete_folder_page(job,dev,binding,page)
       is distinct from true then
    raise exception 'folder page completion refused';
  end if;
  if (public.bridge_server_read_folder_page(job,admin_id)) is distinct from page then
    raise exception 'authorized admin catalogue mismatch';
  end if;
  begin
    perform public.bridge_server_read_folder_page(job,stranger);
    raise exception 'other account read folder';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.bridge_server_complete_folder_page(job,dev,binding,page);
    raise exception 'duplicate file catalogue accepted';
  exception when sqlstate '42501' then null;
  end;

  perform public.bridge_server_enqueue_list(other_job,dev,admin_id);
  if public.bridge_server_claim_list(dev,binding) is distinct from other_job then
    raise exception 'second job not dispatched';
  end if;
  perform public.bridge_owner_revoke(dev,admin_id);
  begin
    perform public.bridge_server_complete_folder_page(other_job,dev,binding,page);
    raise exception 'revoked job delivered folder';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.bridge_server_read_folder_page(job,admin_id);
    raise exception 'revoked admin read old folder';
  exception when sqlstate '42501' then null;
  end;
end $verify$;
select 'bridge-folder-catalogue-ok' as result;
