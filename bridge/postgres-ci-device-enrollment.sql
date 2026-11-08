-- Disposable CI only. Actual Supabase staging has separate deployment review.
\set ON_ERROR_STOP on
do $check$
declare
  owner_id uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  admin_id uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  dev uuid := 'e1111111-1111-4111-8111-111111111111';
  alien uuid := 'e2222222-2222-4222-8222-222222222222';
begin
  if has_function_privilege('authenticated',
      'public.bridge_server_enroll_device(uuid,uuid,text,text,text)','EXECUTE')
     or has_function_privilege('anon',
      'public.bridge_server_delete_device(uuid,uuid)','EXECUTE')
     or not has_function_privilege('service_role',
      'public.bridge_server_enroll_device(uuid,uuid,text,text,text)','EXECUTE') then
    raise exception 'insecure enrollment privileges';
  end if;
  if public.bridge_server_enroll_device(dev,owner_id,'Android',
    repeat('a',32),repeat('b',64)) is distinct from dev then
    raise exception 'device not enrolled';
  end if;
  if (select bridge_enabled from public.bridge_devices where id=dev) is distinct from false then
    raise exception 'device enrolled enabled';
  end if;
  if not exists(select 1 from public.bridge_device_verifiers where device_id=dev)
     then raise exception 'verifier not inserted';end if;
  begin
    perform public.bridge_server_enroll_device(dev,owner_id,'duplicate',
      repeat('a',32),repeat('b',64));
    raise exception 'duplicate enrollment accepted';
  exception when unique_violation then null;
  end;
  begin
    perform public.bridge_server_delete_device(dev,admin_id);
    raise exception 'foreign user deleted device';
  exception when sqlstate '42501' then null;
  end;
  insert into public.bridge_devices(id,owner_id,label) values(alien,owner_id,'Extra');
  update public.profiles set status='blocked' where id=owner_id;
  begin
    perform public.bridge_server_enroll_device(
      'e3333333-3333-4333-8333-333333333333',owner_id,'blocked',
      repeat('a',32),repeat('b',64));
    raise exception 'blocked owner enrolled device';
  exception when sqlstate '42501' then null;
  end;
  update public.profiles set status='approved' where id=owner_id;
  if public.bridge_server_delete_device(dev,owner_id) is distinct from true then
    raise exception 'owner delete failed';
  end if;
  if exists(select 1 from public.bridge_device_verifiers where device_id=dev)
     then raise exception 'verifier not deleted with device';end if;
end $check$;
select 'bridge-owner-enrollment-ok' as result;
