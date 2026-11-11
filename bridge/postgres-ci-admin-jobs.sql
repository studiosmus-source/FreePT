-- Only for ephemeral PostgreSQL CI, after bridge/postgres-ci-tests.sql.
\set ON_ERROR_STOP on
do $verify$
declare
 d uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
 owner_id uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 admin_id uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 stranger uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 queued uuid := '77777777-7777-4777-8777-777777777777';
 sent uuid := '88888888-8888-4888-8888-888888888888';
 done_id uuid := '99999999-9999-4999-8999-999999999999';
 status jsonb;
begin
 if has_function_privilege('authenticated','public.bridge_server_job_status(uuid,uuid)','EXECUTE')
 or has_function_privilege('anon','public.bridge_server_cancel_job(uuid,uuid)','EXECUTE')
 or not has_function_privilege('service_role','public.bridge_server_job_status(uuid,uuid)','EXECUTE')
 or not has_function_privilege('service_role','public.bridge_server_cancel_job(uuid,uuid)','EXECUTE') then
   raise exception 'invalid Bridge admin RPC privileges';
 end if;
 insert into public.bridge_devices(id,owner_id,label) values(d,owner_id,'Admin TX CI');
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 perform public.bridge_owner_grant(d,admin_id);
 perform public.bridge_owner_set_enabled(d,true);
 perform public.bridge_server_enqueue_list(queued,d,admin_id);
 status:=public.bridge_server_job_status(queued,admin_id);
 if status->>'state'<>'queued' or status->>'jobId'<>queued::text or status->>'deviceId'<>d::text then
   raise exception 'bad queued status';
 end if;
 begin
   perform public.bridge_server_job_status(queued,stranger);
   raise exception 'cross-admin status leak';
 exception when sqlstate '42501' then null;
 end;
 begin
   perform public.bridge_server_cancel_job(queued,stranger);
   raise exception 'cross-admin cancellation';
 exception when sqlstate '42501' then null;
 end;
 status:=public.bridge_server_cancel_job(queued,admin_id);
 if status->>'state'<>'cancelled' then raise exception 'cancel failed'; end if;
 if public.bridge_server_claim_list(d,repeat('a',64)) is not null then
   raise exception 'cancelled job dispatched';
 end if;
 begin
   perform public.bridge_server_cancel_job(queued,admin_id);
   raise exception 'repeated cancel accepted';
 exception when sqlstate '23514' then null;
 end;
 perform public.bridge_server_enqueue_list(sent,d,admin_id);
 if public.bridge_server_claim_list(d,repeat('a',64)) is distinct from sent then
   raise exception 'sent job claim failed';
 end if;
 perform public.bridge_owner_revoke(d,admin_id);
 -- Revocation now atomically cancels sent work and clears its binding.
 -- The requester retains read access to their already-cancelled work.
 status:=public.bridge_server_job_status(sent,admin_id);
 if status->>'state'<>'cancelled' then raise exception 'revoked sent job still active'; end if;
 begin
   perform public.bridge_server_cancel_job(sent,admin_id);
   raise exception 'revoked job cancelled twice';
 exception when sqlstate '23514' then null;
 end;
 begin
   perform public.bridge_server_complete_list(sent,d,repeat('a',64));
   raise exception 'cancelled sent job completed';
 exception when sqlstate '42501' then null;
 end;
 perform public.bridge_owner_grant(d,admin_id);
 perform public.bridge_server_enqueue_list(done_id,d,admin_id);
 if public.bridge_server_claim_list(d,repeat('b',64)) is distinct from done_id then
   raise exception 'final job claim failed';
 end if;
 perform public.bridge_server_complete_list(done_id,d,repeat('b',64));
 status:=public.bridge_server_job_status(done_id,admin_id);
 if status->>'state'<>'done' then raise exception 'done status failed'; end if;
 begin
   perform public.bridge_server_cancel_job(done_id,admin_id);
   raise exception 'completed job cancelled';
 exception when sqlstate '23514' then null;
 end;
end
$verify$;
select 'bridge-postgres-admin-jobs-ok' as result;
