-- Real PostgreSQL test: nested SAF folder paging and grant fences.
\set ON_ERROR_STOP on
do $test$
declare
  dev uuid:='81111111-1111-4111-8111-111111111111';
  owner_id uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  admin_id uuid:='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  stranger uuid:='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  job_root uuid:='82222222-2222-4222-8222-222222222222';
  job_nested uuid:='83333333-3333-4333-8333-333333333333';
  job_after uuid:='84444444-4444-4444-8444-444444444444';
  file_job uuid:='85555555-5555-4555-8555-555555555555';
  folder_handle uuid:='86666666-6666-4666-8666-666666666666';
  file_handle uuid:='87777777-7777-4777-8777-777777777777';
  bind text:=repeat('abcdef0102030405',4);
  verifier text:=repeat('d',64);
  claimed jsonb;
  page jsonb;
begin
  if has_function_privilege('authenticated',
      'public.bridge_server_enqueue_browse(uuid,uuid,uuid,text,integer)','EXECUTE') or
     has_table_privilege('authenticated','public.bridge_browse_requests','SELECT') then
    raise exception 'browse permissions too broad';
  end if;
  insert into public.bridge_devices(id,owner_id,label) values(dev,owner_id,'Browse test');
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  perform public.bridge_owner_grant(dev,admin_id);
  perform public.bridge_owner_set_enabled(dev,true);
  insert into public.bridge_device_verifiers(device_id,salt_hex,verifier_hex)
    values(dev,repeat('b',32),verifier);
  perform public.bridge_server_open_tx_session(dev,bind,verifier);
  begin
    perform public.bridge_server_enqueue_browse(job_nested,dev,stranger,'root',0);
    raise exception 'unapproved browse accepted';
  exception when sqlstate '42501' then null; end;
  begin
    perform public.bridge_server_enqueue_browse(job_nested,dev,admin_id,
      folder_handle::text,0);
    raise exception 'unlisted folder browsed';
  exception when sqlstate '42501' then null; end;
  perform public.bridge_server_enqueue_browse(job_root,dev,admin_id,'root',0);
  claimed:=public.bridge_server_claim_browse(dev,bind);
  if claimed->>'jobId'<>job_root::text or claimed->>'handle'<>'root' then
    raise exception 'root claim invalid'; end if;
  perform public.bridge_server_complete_browse_page(job_root,dev,bind,
    jsonb_build_array(jsonb_build_object('handle',folder_handle::text,
      'name','Photos','directory',true,'size',-1,
      'mime','vnd.android.document/directory')),-1);
  page:=public.bridge_server_read_browse_page(job_root,admin_id);
  if jsonb_array_length(page->'entries')<>1 or (page->>'nextOffset')::integer<>-1 then
    raise exception 'root catalogue wrong'; end if;
  perform public.bridge_server_enqueue_browse(job_nested,dev,admin_id,
    folder_handle::text,0);
  claimed:=public.bridge_server_claim_browse(dev,bind);
  if claimed->>'jobId'<>job_nested::text or claimed->>'handle'<>folder_handle::text then
    raise exception 'nested claim invalid'; end if;
  perform public.bridge_server_complete_browse_page(job_nested,dev,bind,
    jsonb_build_array(jsonb_build_object('handle',file_handle::text,
      'name','travel.jpg','directory',false,'size',3,'mime','image/jpeg')),-1);
  perform public.bridge_server_enqueue_read(file_job,dev,admin_id,file_handle,0,3);
  if (public.bridge_server_read_browse_page(job_nested,admin_id)->'entries'->0->>'name')
       <>'travel.jpg' then raise exception 'nested catalogue unavailable'; end if;
  perform public.bridge_server_enqueue_browse(job_after,dev,admin_id,
    folder_handle::text,0);
  claimed:=public.bridge_server_claim_browse(dev,bind);
  perform public.bridge_owner_revoke(dev,admin_id);
  begin
    perform public.bridge_server_complete_browse_page(job_after,dev,bind,
       '[]'::jsonb,-1);
    raise exception 'revoked TX wrote browse catalogue';
  exception when sqlstate '42501' then null; end;
  begin
    perform public.bridge_server_read_browse_page(job_nested,admin_id);
    raise exception 'revoked admin retained browse access';
  exception when sqlstate '42501' then null; end;
end
$test$;
select 'bridge-browse-ok' as result;
