-- Disposable PostgreSQL 16 CI only. Runs after all Bridge migrations.
\set ON_ERROR_STOP on
do $test$
declare
 d uuid := 'abababab-abab-4bab-8bab-abababababab';
 owner_id uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 admin_id uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 token_a text := repeat('1',64);
 token_b text := repeat('2',64);
 token_c text := repeat('3',64);
 verifier_a text := repeat('a',64);
 verifier_b text := repeat('b',64);
 job_a uuid := '71717171-7171-4171-8171-717171717171';
 expiry timestamptz;
begin
 if has_table_privilege('authenticated','public.bridge_tx_sessions','SELECT')
    or has_table_privilege('authenticated','public.bridge_tx_sessions','UPDATE')
    or has_function_privilege('authenticated',
      'public.bridge_server_open_tx_session(uuid,text,text)','EXECUTE')
    or has_function_privilege('anon',
      'public.bridge_server_assert_tx_session(uuid,text)','EXECUTE')
    or has_function_privilege('authenticated',
      'public.bridge_server_close_tx_session(uuid,text)','EXECUTE') then
   raise exception 'TX sessions exposed to client role';
 end if;
 if not has_function_privilege('service_role',
   'public.bridge_server_open_tx_session(uuid,text,text)','EXECUTE')
   or not has_function_privilege('service_role',
   'public.bridge_server_assert_tx_session(uuid,text)','EXECUTE')
   or not has_function_privilege('service_role',
   'public.bridge_server_close_tx_session(uuid,text)','EXECUTE') then
   raise exception 'service_role missing TX session RPC permissions';
 end if;
 insert into public.bridge_devices(id,owner_id,label)
 values(d,owner_id,'Session CI TX');
 insert into public.bridge_device_verifiers(device_id,salt_hex,verifier_hex)
 values(d,repeat('c',32),verifier_a);
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 perform public.bridge_owner_grant(d,admin_id);
 perform public.bridge_owner_set_enabled(d,true);

 begin
   perform public.bridge_server_open_tx_session(d,token_a,verifier_b);
   raise exception 'wrong verifier granted session';
 exception when sqlstate '42501' then null;
 end;
 expiry:=public.bridge_server_open_tx_session(d,token_a,verifier_a);
 if expiry <= clock_timestamp() or expiry > clock_timestamp()+interval '5 minutes 2 seconds' then
   raise exception 'bad session TTL';
 end if;
 if public.bridge_server_assert_tx_session(d,token_a)<>token_a then
   raise exception 'valid session rejected';
 end if;

 -- Reconnect supersedes old bearer and fences already-dispatched work.
 perform public.bridge_server_enqueue_list(job_a,d,admin_id);
 if public.bridge_server_claim_list(d,token_a) is distinct from job_a then
   raise exception 'session fixture claim failed';
 end if;
 perform public.bridge_server_open_tx_session(d,token_b,verifier_a);
 begin
   perform public.bridge_server_assert_tx_session(d,token_a);
   raise exception 'old reconnect session revived';
 exception when sqlstate '42501' then null;
 end;
 if (select state from public.bridge_jobs where id=job_a)<>'cancelled' then
   raise exception 'reconnect did not fence sent work';
 end if;
 if public.bridge_server_assert_tx_session(d,token_b)<>token_b then
   raise exception 'reconnected session not valid';
 end if;
 if public.bridge_server_close_tx_session(d,token_a) then
   raise exception 'old session could close active session';
 end if;

 -- Server-side time determines expiry, never client time.
 update public.bridge_tx_sessions
   set expires_at=clock_timestamp()-interval '1 second'
   where device_id=d;
 begin
   perform public.bridge_server_assert_tx_session(d,token_b);
   raise exception 'expired session accepted';
 exception when sqlstate '42501' then null;
 end;
 perform public.bridge_server_open_tx_session(d,token_b,verifier_a);

 -- Rotation invalidates session even without owner switch.
 update public.bridge_device_verifiers
   set verifier_hex=verifier_b,rotated_at=clock_timestamp()
   where device_id=d;
 if exists(select 1 from public.bridge_tx_sessions where device_id=d) then
   raise exception 'verifier rotation did not revoke session';
 end if;
 begin
   perform public.bridge_server_assert_tx_session(d,token_b);
   raise exception 'rotated verifier revived old session';
 exception when sqlstate '42501' then null;
 end;
 perform public.bridge_server_open_tx_session(d,token_c,verifier_b);
 perform public.bridge_owner_set_enabled(d,false);
 if exists(select 1 from public.bridge_tx_sessions where device_id=d) then
   raise exception 'owner OFF did not revoke session';
 end if;
 perform public.bridge_owner_set_enabled(d,true);
 begin
   perform public.bridge_server_assert_tx_session(d,token_c);
   raise exception 'owner ON revived session';
 exception when sqlstate '42501' then null;
 end;
 perform public.bridge_server_open_tx_session(d,token_a,verifier_b);
 if not public.bridge_server_close_tx_session(d,token_a) then
   raise exception 'valid session close failed';
 end if;
 begin
   perform public.bridge_server_assert_tx_session(d,token_a);
   raise exception 'closed session accepted';
 exception when sqlstate '42501' then null;
 end;
end
$test$;
select 'bridge-postgres-tx-sessions-ok' as result;
