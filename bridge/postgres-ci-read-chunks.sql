-- Disposable PostgreSQL read-chunk integration and revocation checks.
\set ON_ERROR_STOP on
do $test$
declare
  dev uuid:='e1111111-1111-4111-8111-111111111111';
  owner_id uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  admin_id uuid:='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  stranger uuid:='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  listing uuid:='e2222222-2222-4222-8222-222222222222';
  readjob uuid:='e3333333-3333-4333-8333-333333333333';
  revokedjob uuid:='e5555555-5555-4555-8555-555555555555';
  file_handle uuid:='e4444444-4444-4444-8444-444444444444';
  binding text:=repeat('d',64);
  verifier text:=repeat('e',64);
  chunk jsonb:=jsonb_build_object('base64','AQID','bytesRead',3,'eof',false);
  claimed jsonb;
begin
  if has_function_privilege('authenticated',
      'public.bridge_server_enqueue_read(uuid,uuid,uuid,uuid,bigint,integer)','EXECUTE') or
     has_table_privilege('authenticated','public.bridge_read_results','SELECT') then
    raise exception 'read permissions too broad';
  end if;
  insert into public.bridge_devices(id,owner_id,label) values(dev,owner_id,'Read test');
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  perform public.bridge_owner_grant(dev,admin_id);
  perform public.bridge_owner_set_enabled(dev,true);
  insert into public.bridge_device_verifiers(device_id,salt_hex,verifier_hex)
    values(dev,repeat('a',32),verifier);
  perform public.bridge_server_open_tx_session(dev,binding,verifier);
  perform public.bridge_server_enqueue_list(listing,dev,admin_id);
  if public.bridge_server_claim_list(dev,binding) is distinct from listing then
    raise exception 'list claim failed'; end if;
  perform public.bridge_server_complete_folder_page(listing,dev,binding,
    jsonb_build_array(jsonb_build_object('handle',file_handle::text,
      'name','test.bin','directory',false,'size',3,'mime','application/octet-stream')));
  begin
    perform public.bridge_server_enqueue_read(readjob,dev,stranger,file_handle,0,3);
    raise exception 'stranger requested chunk';
  exception when sqlstate '42501' then null; end;
  begin
    perform public.bridge_server_enqueue_read(readjob,dev,admin_id,file_handle,0,4);
    raise exception 'out-of-bounds chunk accepted';
  exception when sqlstate '42501' then null; end;
  perform public.bridge_server_enqueue_read(readjob,dev,admin_id,file_handle,0,3);
  if public.bridge_server_claim_list(dev,binding) is not null then
    raise exception 'list claimed read job'; end if;
  claimed:=public.bridge_server_claim_read(dev,binding);
  if claimed->>'jobId'<>readjob::text or claimed->>'handle'<>file_handle::text or
     (claimed->>'length')::int<>3 then
    raise exception 'read payload wrong'; end if;
  begin
    perform public.bridge_server_complete_read(readjob,dev,repeat('a',64),chunk);
    raise exception 'bad TX session accepted';
  exception when sqlstate '42501' then null; end;
  begin
    perform public.bridge_server_complete_read(readjob,dev,binding,
      jsonb_build_object('base64','!!!','bytesRead',3,'eof',false));
    raise exception 'bad base64 accepted';
  exception when sqlstate '22023' then null; end;
  if public.bridge_server_complete_read(readjob,dev,binding,chunk) is distinct from true then
    raise exception 'read completion failed'; end if;
  if public.bridge_server_read_chunk(readjob,admin_id) is distinct from chunk then
    raise exception 'read result mismatch'; end if;
  begin
    perform public.bridge_server_read_chunk(readjob,stranger);
    raise exception 'stranger read result';
  exception when sqlstate '42501' then null; end;
  perform public.bridge_server_enqueue_read(revokedjob,dev,admin_id,file_handle,0,3);
  if public.bridge_server_claim_read(dev,binding) is null then
    raise exception 'second read claim failed'; end if;
  perform public.bridge_owner_revoke(dev,admin_id);
  begin
    perform public.bridge_server_complete_read(revokedjob,dev,binding,chunk);
    raise exception 'revoked TX completed chunk';
  exception when sqlstate '42501' then null; end;
  begin
    perform public.bridge_server_read_chunk(readjob,admin_id);
    raise exception 'revoked admin read old bytes';
  exception when sqlstate '42501' then null; end;
end
$test$;
select 'bridge-read-chunks-ok' as result;
