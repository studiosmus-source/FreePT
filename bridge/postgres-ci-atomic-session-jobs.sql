-- Disposable PostgreSQL CI only. Executed AFTER strict session job RPCs installed.
\set ON_ERROR_STOP on
do $checks$
declare
 d uuid := 'bcbcbcbc-bcbc-4bcb-8bcb-bcbcbcbcbcbc';
 owner_id uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 admin_id uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 valid_hash text := repeat('a',64);
 old_hash text := repeat('b',64);
 new_hash text := repeat('c',64);
 verifier text := repeat('d',64);
 first_job uuid := '81818181-8181-4181-8181-818181818181';
 second_job uuid := '82828282-8282-4282-8282-828282828282';
 third_job uuid := '83838383-8383-4383-8383-838383838383';
 fourth_job uuid := '84848484-8484-4484-8484-848484848484';
 claimed uuid;
begin
 insert into public.bridge_devices(id,owner_id,label) values(d,owner_id,'Strict TX CI');
 insert into public.bridge_device_verifiers(device_id,salt_hex,verifier_hex)
 values(d,repeat('e',32),verifier);
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 perform public.bridge_owner_grant(d,admin_id);
 perform public.bridge_owner_set_enabled(d,true);
 perform public.bridge_server_enqueue_list(first_job,d,admin_id);

 -- Critically, an enabled Bridge and active admin grant are insufficient:
 -- no authorized TX session means no dispatch.
 begin
   perform public.bridge_server_claim_list(d,valid_hash);
   raise exception 'claim without shared session accepted';
 exception when sqlstate '42501' then null;
 end;
 if (select state from public.bridge_jobs where id=first_job)<>'queued' then
   raise exception 'unauthorized poll mutated queue';
 end if;
 perform public.bridge_server_open_tx_session(d,valid_hash,verifier);
 claimed:=public.bridge_server_claim_list(d,valid_hash);
 if claimed is distinct from first_job then
   raise exception 'live TX could not claim first job';
 end if;
 begin
   perform public.bridge_server_complete_list(first_job,d,old_hash);
   raise exception 'unbound TX completed job';
 exception when sqlstate '42501' then null;
 end;
 perform public.bridge_server_open_tx_session(d,new_hash,verifier);
 if (select state from public.bridge_jobs where id=first_job)<>'cancelled' then
   raise exception 'reconnect did not cancel old work';
 end if;
 begin
   perform public.bridge_server_complete_list(first_job,d,valid_hash);
   raise exception 'prior TX completed after reconnect';
 exception when sqlstate '42501' then null;
 end;
 perform public.bridge_server_enqueue_list(second_job,d,admin_id);
 begin
   perform public.bridge_server_claim_list(d,valid_hash);
   raise exception 'prior TX claimed after reconnect';
 exception when sqlstate '42501' then null;
 end;
 if public.bridge_server_claim_list(d,new_hash) is distinct from second_job then
   raise exception 'new TX claim denied';
 end if;
 if not public.bridge_server_complete_list(second_job,d,new_hash) then
   raise exception 'new TX completion denied';
 end if;

 perform public.bridge_server_enqueue_list(third_job,d,admin_id);
 update public.bridge_tx_sessions
    set created_at=clock_timestamp()-interval '3 seconds',
        expires_at=clock_timestamp()-interval '1 second'
    where device_id=d;
 begin
   perform public.bridge_server_claim_list(d,new_hash);
   raise exception 'expired session claimed job';
 exception when sqlstate '42501' then null;
 end;
 if (select state from public.bridge_jobs where id=third_job)<>'queued' then
   raise exception 'expired poll mutated queue';
 end if;
 perform public.bridge_server_open_tx_session(d,valid_hash,verifier);
 if public.bridge_server_claim_list(d,valid_hash) is distinct from third_job then
   raise exception 'newly opened session could not claim';
 end if;
 perform public.bridge_server_close_tx_session(d,valid_hash);
 begin
   perform public.bridge_server_complete_list(third_job,d,valid_hash);
   raise exception 'closed session completed job';
 exception when sqlstate '42501' then null;
 end;

 perform public.bridge_server_open_tx_session(d,new_hash,verifier);
 perform public.bridge_server_enqueue_list(fourth_job,d,admin_id);
 perform public.bridge_owner_set_enabled(d,false);
 perform public.bridge_owner_set_enabled(d,true);
 begin
   perform public.bridge_server_claim_list(d,new_hash);
   raise exception 'owner ON revived prior TX session';
 exception when sqlstate '42501' then null;
 end;
 if (select state from public.bridge_jobs where id=fourth_job)<>'cancelled' then
   raise exception 'OFF did not fence queued job';
 end if;
end
$checks$;
select 'bridge-postgres-atomic-session-jobs-ok' as result;
