-- STAGING ONLY: the device owner explicitly approves one named FreePT
-- family administrator through a single guided action.
-- Never apply to FreePT production. Fail closed when no unique approved admin.
create or replace function public.bridge_owner_activate_family(p_device_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_admins uuid[];
  v_receiver uuid;
begin
  if (select auth.uid()) is null
     or not (select public.freept_is_approved()) then
    raise exception 'bridge_owner_not_approved' using errcode='42501';
  end if;
  if p_device_id is null then
    raise exception 'bridge_invalid_device' using errcode='22023';
  end if;
  -- Lock owner device before altering either access state. The owner is
  -- derived from the authenticated session, never supplied by the client.
  perform 1 from public.bridge_devices d
    where d.id=p_device_id and d.owner_id=(select auth.uid())
    for update;
  if not found then
    raise exception 'bridge_owner_required' using errcode='42501';
  end if;
  select array_agg(p.id order by p.id) into v_admins
  from public.profiles p
  where p.role='admin' and p.status='approved';
  if coalesce(array_length(v_admins,1),0)<>1 then
    raise exception 'bridge_unique_admin_required' using errcode='42501';
  end if;
  v_receiver:=v_admins[1];
  insert into public.bridge_grants(device_id,receiver_id,approved_at,revoked_at)
  values(p_device_id,v_receiver,clock_timestamp(),null)
  on conflict(device_id,receiver_id) do update
    set approved_at=excluded.approved_at,revoked_at=null;
  update public.bridge_devices
    set bridge_enabled=true,updated_at=clock_timestamp()
    where id=p_device_id and owner_id=(select auth.uid());
  return v_receiver;
end;
$$;
revoke all on function public.bridge_owner_activate_family(uuid) from public,anon;
grant execute on function public.bridge_owner_activate_family(uuid) to authenticated;
