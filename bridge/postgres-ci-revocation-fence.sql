-- Real PostgreSQL 16 CI regression, disposable database only.
\set ON_ERROR_STOP on
do $checks$
declare
  d uuid := 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  owner_id uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  admin_id uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  sent_id uuid := '10101010-1010-4010-8010-101010101010';
  queued_id uuid := '20202020-2020-4020-8020-202020202020';
  fresh_id uuid := '30303030-3030-4030-8030-303030303030';
  off_sent uuid := '40404040-4040-4040-8040-404040404040';
  off_queued uuid := '50505050-5050-4050-8050-505050505050';
  new_id uuid := '60606060-6060-4060-8060-606060606060';
  selected uuid;
begin
  insert into public.bridge_devices(id,owner_id,label) values(d,owner_id,'Revocation CI TX');
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  perform public.bridge_owner_grant(d,admin_id);
  perform public.bridge_owner_set_enabled(d,true);
  perform public.bridge_server_enqueue_list(sent_id,d,admin_id);
  perform public.bridge_server_enqueue_list(queued_id,d,admin_id);
  selected:=public.bridge_server_claim_list(d,repeat('a',64));
  if selected is distinct from sent_id then raise exception 'sent fixture missing'; end if;

  perform public.bridge_owner_revoke(d,admin_id);
  if (select count(*) from public.bridge_jobs
      where id in (sent_id,queued_id) and state='cancelled'
        and session_binding_hex is null)<>2 then
    raise exception 'grant revocation did not fence both jobs';
  end if;
  perform public.bridge_owner_grant(d,admin_id);
  begin
    perform public.bridge_server_complete_list(sent_id,d,repeat('a',64));
    raise exception 'old dispatched job revived after regrant';
  exception when sqlstate '42501' then null;
  end;
  if public.bridge_server_claim_list(d,repeat('a',64)) is not null then
    raise exception 'old queued job revived after regrant';
  end if;
  perform public.bridge_server_enqueue_list(fresh_id,d,admin_id);
  if public.bridge_server_claim_list(d,repeat('b',64)) is distinct from fresh_id then
    raise exception 'fresh work failed after regrant';
  end if;
  if not public.bridge_server_complete_list(fresh_id,d,repeat('b',64)) then
    raise exception 'fresh work cannot complete';
  end if;

  perform public.bridge_server_enqueue_list(off_sent,d,admin_id);
  perform public.bridge_server_enqueue_list(off_queued,d,admin_id);
  if public.bridge_server_claim_list(d,repeat('c',64)) is distinct from off_sent then
    raise exception 'owner-off fixture claim failed';
  end if;
  perform public.bridge_owner_set_enabled(d,false);
  if (select count(*) from public.bridge_jobs
      where id in (off_sent,off_queued) and state='cancelled'
        and session_binding_hex is null)<>2 then
    raise exception 'owner OFF did not fence both jobs';
  end if;
  perform public.bridge_owner_set_enabled(d,true);
  begin
    perform public.bridge_server_complete_list(off_sent,d,repeat('c',64));
    raise exception 'old dispatched job revived after owner ON';
  exception when sqlstate '42501' then null;
  end;
  if public.bridge_server_claim_list(d,repeat('c',64)) is not null then
    raise exception 'old queued job revived after owner ON';
  end if;
  if (select state from public.bridge_jobs where id=fresh_id)<>'done' then
    raise exception 'completed job modified by owner OFF';
  end if;
  perform public.bridge_server_enqueue_list(new_id,d,admin_id);
  if public.bridge_server_claim_list(d,repeat('d',64)) is distinct from new_id then
    raise exception 'fresh job not dispatched after owner ON';
  end if;
end
$checks$;
select 'bridge-postgres-revocation-fence-ok' as result;
