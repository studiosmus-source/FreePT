-- DRAFT: install ONLY on a disposable test database after bridge_foundation.
-- Owner-scoped mutations for existing, trusted-server-registered devices.
-- This does NOT register a device or prove device possession.
-- Device service authentication and in-flight transfer cancellation remain backend responsibilities.
--
-- SECURITY DEFINER is intentional: the client has no direct table writes.
-- Every entry point derives the owner identity from auth.uid() and locks the
-- specific device row; p_device_id is never treated as proof of ownership.

create or replace function public.bridge_owner_set_enabled(
  p_device_id uuid, p_enabled boolean
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or not (select public.freept_is_approved()) then
    raise exception 'bridge_owner_not_approved' using errcode = '42501';
  end if;
  if p_device_id is null or p_enabled is null then
    raise exception 'invalid_bridge_request' using errcode = '22023';
  end if;

  perform 1 from public.bridge_devices
    where id = p_device_id and owner_id = (select auth.uid())
    for update;
  if not found then
    raise exception 'bridge_owner_required' using errcode = '42501';
  end if;

  update public.bridge_devices
    set bridge_enabled = p_enabled, updated_at = clock_timestamp()
    where id = p_device_id;
end;
$$;

create or replace function public.bridge_owner_grant(
  p_device_id uuid, p_receiver_id uuid
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or not (select public.freept_is_approved()) then
    raise exception 'bridge_owner_not_approved' using errcode = '42501';
  end if;
  if p_device_id is null or p_receiver_id is null then
    raise exception 'invalid_bridge_request' using errcode = '22023';
  end if;

  perform 1 from public.bridge_devices
    where id = p_device_id and owner_id = (select auth.uid())
    for update;
  if not found then
    raise exception 'bridge_owner_required' using errcode = '42501';
  end if;

  -- Only an approved admin may be granted access as a receiver.
  if not exists (
    select 1 from public.profiles p
    where p.id = p_receiver_id and p.role = 'admin' and p.status = 'approved'
  ) then
    raise exception 'bridge_receiver_not_admin' using errcode = '42501';
  end if;

  insert into public.bridge_grants(device_id, receiver_id, approved_at, revoked_at)
    values(p_device_id, p_receiver_id, clock_timestamp(), null)
    on conflict(device_id, receiver_id) do update
    set approved_at = excluded.approved_at, revoked_at = null;
end;
$$;

create or replace function public.bridge_owner_revoke(
  p_device_id uuid, p_receiver_id uuid
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or not (select public.freept_is_approved()) then
    raise exception 'bridge_owner_not_approved' using errcode = '42501';
  end if;
  if p_device_id is null or p_receiver_id is null then
    raise exception 'invalid_bridge_request' using errcode = '22023';
  end if;

  perform 1 from public.bridge_devices
    where id = p_device_id and owner_id = (select auth.uid())
    for update;
  if not found then
    raise exception 'bridge_owner_required' using errcode = '42501';
  end if;

  update public.bridge_grants
    set revoked_at = greatest(clock_timestamp(), approved_at)
    where device_id = p_device_id and receiver_id = p_receiver_id
      and revoked_at is null;
end;
$$;

-- The untrusted client can call only these narrow, owner-verified operations.
-- No INSERT/UPDATE/DELETE access to bridge_* tables is granted.
revoke all on function public.bridge_owner_set_enabled(uuid, boolean)
  from public, anon;
revoke all on function public.bridge_owner_grant(uuid, uuid)
  from public, anon;
revoke all on function public.bridge_owner_revoke(uuid, uuid)
  from public, anon;

grant execute on function public.bridge_owner_set_enabled(uuid, boolean)
  to authenticated;
grant execute on function public.bridge_owner_grant(uuid, uuid)
  to authenticated;
grant execute on function public.bridge_owner_revoke(uuid, uuid)
  to authenticated;
