-- STAGING ONLY — install after Bridge foundation + verifiers + owner controls.
-- This is trusted-server-only device enrollment. Browser clients must never
-- invoke it; backend MUST validate Supabase Auth and derive p_owner_id itself.
-- A single transaction creates device and verifier together. The raw secret
-- never enters SQL, logs, tables or GitHub.
create or replace function public.bridge_server_enroll_device(
  p_device_id uuid, p_owner_id uuid, p_label text,
  p_salt_hex text, p_verifier_hex text
) returns uuid
language plpgsql security invoker set search_path = ''
as $$
begin
  if p_device_id is null or p_owner_id is null or
     p_label is null or char_length(p_label) not between 1 and 100 or
     p_label ~ '[[:cntrl:]]' or
     p_salt_hex is null or p_salt_hex !~ '^[0-9a-f]{32}$' or
     p_verifier_hex is null or p_verifier_hex !~ '^[0-9a-f]{64}$' then
    raise exception 'bridge_device_enrollment_invalid' using errcode='22023';
  end if;
  -- Locks the verified owner's profile and refuses a suspended/pending user.
  -- The caller identity must be independently verified by the trusted server.
  perform 1 from public.profiles p
    where p.id=p_owner_id and p.status='approved' for update;
  if not found then
    raise exception 'bridge_device_owner_denied' using errcode='42501';
  end if;
  -- Limit per owner to avoid an unbounded inventory; concurrent operations
  -- serialize on the owner's locked profile row.
  if (select count(*) from public.bridge_devices
      where owner_id=p_owner_id)>=5 then
    raise exception 'bridge_device_limit' using errcode='23514';
  end if;
  insert into public.bridge_devices
    (id,owner_id,label,bridge_enabled)
    values(p_device_id,p_owner_id,p_label,false);
  insert into public.bridge_device_verifiers
    (device_id,salt_hex,verifier_hex)
    values(p_device_id,p_salt_hex,p_verifier_hex);
  return p_device_id;
end;
$$;

-- Revocation of the device itself. Existing FK cascades clean up grants,
-- jobs, TX sessions and folder pages. Client may not invoke this privileged
-- operation: the server must verify owner identity on every request.
create or replace function public.bridge_server_delete_device(
  p_device_id uuid,p_owner_id uuid
) returns boolean
language plpgsql security invoker set search_path = ''
as $$
declare v_count integer;
begin
  if p_device_id is null or p_owner_id is null then
    raise exception 'bridge_device_invalid' using errcode='22023';
  end if;
  perform 1 from public.bridge_devices d
    where d.id=p_device_id and d.owner_id=p_owner_id for update;
  if not found then
    raise exception 'bridge_device_owner_denied' using errcode='42501';
  end if;
  delete from public.bridge_devices
    where id=p_device_id and owner_id=p_owner_id;
  get diagnostics v_count=row_count;
  return v_count=1;
end;
$$;
revoke all on function public.bridge_server_enroll_device(uuid,uuid,text,text,text)
  from public,anon,authenticated;
revoke all on function public.bridge_server_delete_device(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.bridge_server_enroll_device(uuid,uuid,text,text,text)
  to service_role;
grant execute on function public.bridge_server_delete_device(uuid,uuid)
  to service_role;
