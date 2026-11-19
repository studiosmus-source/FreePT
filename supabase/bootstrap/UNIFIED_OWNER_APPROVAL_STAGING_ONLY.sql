-- Isolated FreePT TEST only. Record the authentic administrator approving
-- a request; never infer the receiver from ordering or a client-supplied ID.
alter table public.profiles add column if not exists approved_by uuid
 references public.profiles(id) on delete set null;
create or replace function public.freept_record_approver()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='approved' and old.status is distinct from new.status then
  if not (select public.freept_is_admin()) then
   raise exception 'freept_admin_required' using errcode='42501';
  end if;
  new.approved_by:=(select auth.uid());
 end if;
 return new;
end; $$;
revoke all on function public.freept_record_approver() from public,anon,authenticated;
create or replace trigger freept_record_approver before update of status on public.profiles
for each row execute function public.freept_record_approver();

create or replace function public.bridge_owner_activate_family(p_device_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_receiver uuid; v_admins uuid[];
begin
 if (select auth.uid()) is null or not (select public.freept_is_approved()) then
  raise exception 'bridge_owner_not_approved' using errcode='42501';
 end if;
 perform 1 from public.bridge_devices where id=p_device_id
  and owner_id=(select auth.uid()) for update;
 if not found then raise exception 'bridge_owner_required' using errcode='42501'; end if;
 select p.approved_by into v_receiver from public.profiles p
  join public.profiles a on a.id=p.approved_by
  where p.id=(select auth.uid()) and a.role='admin' and a.status='approved';
 if v_receiver is null then
  -- Historical installs retain the previous fail-closed unique-admin rule.
  -- Synthetic administrators must never become the implicit recipient for
  -- an older real installation. Trusted fixture metadata is server-managed.
  select array_agg(p.id) into v_admins from public.profiles p
   join auth.users u on u.id=p.id
   where p.role='admin' and p.status='approved'
    and coalesce(u.raw_app_meta_data->>'freept_test_fixture','')='';
  if coalesce(array_length(v_admins,1),0)<>1 then
   raise exception 'bridge_unique_admin_required' using errcode='42501';
  end if;
  v_receiver:=v_admins[1];
 end if;
 insert into public.bridge_grants(device_id,receiver_id,approved_at,revoked_at)
 values(p_device_id,v_receiver,clock_timestamp(),null)
 on conflict(device_id,receiver_id) do update
  set approved_at=excluded.approved_at,revoked_at=null;
 update public.bridge_devices set bridge_enabled=true,updated_at=clock_timestamp()
  where id=p_device_id and owner_id=(select auth.uid());
 return v_receiver;
end; $$;
revoke all on function public.bridge_owner_activate_family(uuid) from public,anon;
grant execute on function public.bridge_owner_activate_family(uuid) to authenticated;
