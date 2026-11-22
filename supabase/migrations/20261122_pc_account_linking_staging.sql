-- STAGING ONLY. One-time Android approval links a desktop Auth session to an
-- already-approved FreePT user profile. Never installs or runs in production.
-- The PC gets no new profile: messages, attachments and Bridge stay on the
-- existing profile id. Android can revoke a PC and its Bridge devices.

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.messages') is null
     or to_regclass('public.bridge_devices') is null
     or to_regclass('public.bridge_grants') is null then
    raise exception 'PC_LINK STOP: required FreePT and Bridge tables are missing';
  end if;
end $$;

create table if not exists public.freept_pc_device_links (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  device_label text not null check (device_label in ('PC Windows','PC macOS','PC')),
  linked_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  check (revoked_at is null or revoked_at >= linked_at)
);
create index if not exists freept_pc_device_links_profile_active_idx
  on public.freept_pc_device_links(profile_id, linked_at desc)
  where revoked_at is null;

create table if not exists public.freept_pc_link_requests (
  request_key text primary key check (request_key ~ '^[0-9A-F]{8}$'),
  pc_auth_user_id uuid not null references auth.users(id) on delete cascade,
  secret_hash bytea not null,
  device_label text not null check (device_label in ('PC Windows','PC macOS','PC')),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts between 0 and 5),
  status text not null default 'pending'
    check (status in ('pending','approved','expired','superseded')),
  profile_id uuid references public.profiles(id) on delete cascade,
  approved_at timestamptz,
  check (expires_at > created_at),
  check ((status='approved')=(profile_id is not null)),
  check ((status='approved')=(approved_at is not null))
);
create index if not exists freept_pc_link_requests_user_idx
  on public.freept_pc_link_requests(pc_auth_user_id, created_at desc);
alter table public.freept_pc_device_links enable row level security;
alter table public.freept_pc_link_requests enable row level security;
revoke all on public.freept_pc_device_links, public.freept_pc_link_requests
  from public, anon, authenticated;

-- Supabase installations may keep pgcrypto in public or extensions. Resolve
-- only those fixed schemas, without depending on a mutable search_path.
create or replace function public.freept_pc_link_hash(p_secret bytea)
returns bytea language plpgsql stable security definer set search_path=''
as $$
declare v_hash bytea;
begin
  if to_regprocedure('public.digest(bytea,text)') is not null then
    execute 'select public.digest($1,$2)' into v_hash using p_secret,'sha256';
  elsif to_regprocedure('extensions.digest(bytea,text)') is not null then
    execute 'select extensions.digest($1,$2)' into v_hash using p_secret,'sha256';
  else
    raise exception 'pc_link_hash_unavailable';
  end if;
  return v_hash;
end;
$$;
revoke all on function public.freept_pc_link_hash(bytea)
  from public, anon, authenticated;

-- A linked desktop keeps its own revocable Auth session while all application
-- data remains scoped to the approved phone profile.
create or replace function public.freept_current_profile_id()
returns uuid
language sql stable security definer set search_path=''
as $$
  select coalesce(
    (select p.id from public.profiles p where p.id=(select auth.uid())),
    (select l.profile_id from public.freept_pc_device_links l
      where l.auth_user_id=(select auth.uid()) and l.revoked_at is null)
  );
$$;
revoke all on function public.freept_current_profile_id() from public, anon;
grant execute on function public.freept_current_profile_id() to authenticated;

create or replace function public.freept_is_admin()
returns boolean language sql stable security definer set search_path=''
as $$
  select exists(select 1 from public.profiles p
    where p.id=(select public.freept_current_profile_id())
      and p.role='admin' and p.status='approved');
$$;
create or replace function public.freept_is_approved()
returns boolean language sql stable security definer set search_path=''
as $$
  select exists(select 1 from public.profiles p
    where p.id=(select public.freept_current_profile_id())
      and p.status='approved');
$$;
revoke all on function public.freept_is_admin() from public;
revoke all on function public.freept_is_approved() from public;
grant execute on function public.freept_is_admin() to authenticated;
grant execute on function public.freept_is_approved() to authenticated;

create or replace function public.freept_current_profile()
returns table(id uuid, full_name text, phone text, role text, status text)
language sql stable security definer set search_path=''
as $$
  select p.id,p.full_name,p.phone,p.role,p.status from public.profiles p
  where p.id=(select public.freept_current_profile_id());
$$;
revoke all on function public.freept_current_profile() from public, anon;
grant execute on function public.freept_current_profile() to authenticated;

drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select to authenticated
  using (id=(select public.freept_current_profile_id())
    or (select public.freept_is_admin()));
drop policy if exists "messages read" on public.messages;
create policy "messages read" on public.messages for select to authenticated
  using ((select public.freept_is_admin()) or
    (user_id=(select public.freept_current_profile_id())
      and (select public.freept_is_approved())));
drop policy if exists "messages write" on public.messages;
create policy "messages write" on public.messages for insert to authenticated
  with check (
    sender_id=(select public.freept_current_profile_id())
    and (select public.freept_is_approved())
    and ((select public.freept_is_admin())
      or user_id=(select public.freept_current_profile_id()))
  );

drop policy if exists "attachments read" on storage.objects;
create policy "attachments read" on storage.objects for select to authenticated
  using (bucket_id='attachments' and
    ((select public.freept_is_admin()) or
      ((select public.freept_is_approved())
        and (storage.foldername(name))[1]=
          (select public.freept_current_profile_id())::text)));
drop policy if exists "attachments upload" on storage.objects;
create policy "attachments upload" on storage.objects for insert to authenticated
  with check (bucket_id='attachments'
    and (select public.freept_is_approved())
    and ((select public.freept_is_admin()) or
      (storage.foldername(name))[1]=
        (select public.freept_current_profile_id())::text));

drop policy if exists "bridge devices owner read" on public.bridge_devices;
create policy "bridge devices owner read" on public.bridge_devices
  for select to authenticated using (
    owner_id=(select public.freept_current_profile_id())
    and (select public.freept_is_approved())
  );
drop policy if exists "bridge grants owner read" on public.bridge_grants;
create policy "bridge grants owner read" on public.bridge_grants
  for select to authenticated using (
    (select public.freept_is_approved())
    and exists(select 1 from public.bridge_devices d
      where d.id=bridge_grants.device_id
        and d.owner_id=(select public.freept_current_profile_id()))
  );
drop policy if exists "bridge audit owner read" on public.bridge_audit_events;
create policy "bridge audit owner read" on public.bridge_audit_events
  for select to authenticated using (
    owner_id=(select public.freept_current_profile_id())
    and (select public.freept_is_approved())
  );

-- PC pairing codes have a 5-minute lifetime, one active request per PC,
-- 30-second restart cooldown and at most five phone-side code attempts.
-- The code contains a 32-bit lookup key and a 64-bit one-time secret.
create or replace function public.freept_pc_link_start(p_device_label text)
returns text
language plpgsql security definer set search_path=''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_code text;
  v_key text;
  v_try integer;
begin
  if v_uid is null or p_device_label not in ('PC Windows','PC macOS','PC')
     or not exists(select 1 from auth.users u
       where u.id=v_uid and u.is_anonymous=true)
     or exists(select 1 from public.profiles p where p.id=v_uid)
     or exists(select 1 from public.freept_pc_device_links l
       where l.auth_user_id=v_uid and l.revoked_at is null) then
    raise exception 'pc_link_start_denied' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text,0));
  if exists(select 1 from public.freept_pc_link_requests r
       where r.pc_auth_user_id=v_uid and r.status='pending'
         and r.created_at>clock_timestamp()-interval '30 seconds') then
    raise exception 'pc_link_wait' using errcode='P0001';
  end if;
  update public.freept_pc_link_requests
    set status='superseded'
    where pc_auth_user_id=v_uid and status='pending';
  for v_try in 1..5 loop
    v_code:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,24));
    v_key:=left(v_code,8);
    insert into public.freept_pc_link_requests
      (request_key,pc_auth_user_id,secret_hash,device_label,expires_at)
      values(v_key,v_uid,public.freept_pc_link_hash(decode(right(v_code,16),'hex')),
        p_device_label,clock_timestamp()+interval '5 minutes')
      on conflict(request_key) do nothing;
    if found then return v_code; end if;
  end loop;
  raise exception 'pc_link_unavailable' using errcode='P0001';
end;
$$;
revoke all on function public.freept_pc_link_start(text) from public, anon;
grant execute on function public.freept_pc_link_start(text) to authenticated;

create or replace function public.freept_pc_link_approve(p_code text)
returns boolean
language plpgsql security definer set search_path=''
as $$
declare
  v_profile uuid := (select public.freept_current_profile_id());
  v_request public.freept_pc_link_requests%rowtype;
  v_role text;
  v_status text;
  v_auth_user_id uuid;
begin
  if (select auth.uid()) is null or p_code is null
     or upper(p_code) !~ '^[0-9A-F]{24}$' then
    return false;
  end if;
  select p.role,p.status into v_role,v_status
    from public.profiles p where p.id=v_profile;
  if v_role is distinct from 'user' or v_status is distinct from 'approved' then
    raise exception 'pc_link_approver_denied' using errcode='42501';
  end if;
  select r.* into v_request from public.freept_pc_link_requests r
    where r.request_key=left(upper(p_code),8) for update;
  if not found then return false; end if;
  if v_request.status='approved' and v_request.profile_id=v_profile then
    return exists(select 1 from public.freept_pc_device_links l
      where l.auth_user_id=v_request.pc_auth_user_id
        and l.profile_id=v_profile and l.revoked_at is null);
  end if;
  if v_request.status<>'pending' or v_request.expires_at<=clock_timestamp()
     or v_request.attempts>=5 then
    update public.freept_pc_link_requests set status='expired'
      where request_key=v_request.request_key and status='pending';
    return false;
  end if;
  update public.freept_pc_link_requests
    set attempts=attempts+1
    where request_key=v_request.request_key;
  if v_request.secret_hash <>
       public.freept_pc_link_hash(decode(right(upper(p_code),16),'hex')) then
    if v_request.attempts+1>=5 then
      update public.freept_pc_link_requests set status='expired'
        where request_key=v_request.request_key;
    end if;
    return false;
  end if;
  if not exists(select 1 from auth.users u
      where u.id=v_request.pc_auth_user_id and u.is_anonymous=true)
     or exists(select 1 from public.profiles p
      where p.id=v_request.pc_auth_user_id)
     or exists(select 1 from public.freept_pc_device_links l
      where l.auth_user_id=v_request.pc_auth_user_id and l.revoked_at is null) then
    update public.freept_pc_link_requests set status='expired'
      where request_key=v_request.request_key;
    return false;
  end if;
  if (select count(*) from public.freept_pc_device_links l
       where l.profile_id=v_profile and l.revoked_at is null)>=5 then
    raise exception 'pc_link_device_limit' using errcode='23514';
  end if;
  v_auth_user_id:=v_request.pc_auth_user_id;
  insert into public.freept_pc_device_links
    (auth_user_id,profile_id,device_label,linked_at,revoked_at)
    values(v_auth_user_id,v_profile,v_request.device_label,clock_timestamp(),null)
    on conflict(auth_user_id) do update
      set profile_id=excluded.profile_id,device_label=excluded.device_label,
          linked_at=excluded.linked_at,revoked_at=null
      where public.freept_pc_device_links.revoked_at is not null;
  if not found then return false; end if;
  update public.freept_pc_link_requests
    set status='approved',profile_id=v_profile,approved_at=clock_timestamp()
    where request_key=v_request.request_key;
  return true;
end;
$$;
revoke all on function public.freept_pc_link_approve(text) from public, anon;
grant execute on function public.freept_pc_link_approve(text) to authenticated;

create or replace function public.freept_pc_link_list()
returns table(auth_user_id uuid,device_label text,linked_at timestamptz)
language sql stable security definer set search_path=''
as $$
  select l.auth_user_id,l.device_label,l.linked_at
    from public.freept_pc_device_links l
    join public.profiles p on p.id=l.profile_id
    where l.profile_id=(select public.freept_current_profile_id())
      and l.revoked_at is null and p.role='user' and p.status='approved'
    order by l.linked_at desc;
$$;
revoke all on function public.freept_pc_link_list() from public, anon;
grant execute on function public.freept_pc_link_list() to authenticated;

create or replace function public.freept_pc_link_revoke(p_auth_user_id uuid)
returns boolean
language plpgsql security definer set search_path=''
as $$
declare
  v_profile uuid := (select public.freept_current_profile_id());
begin
  if (select auth.uid()) is null or p_auth_user_id is null
     or not exists(select 1 from public.profiles p
       where p.id=v_profile and p.role='user' and p.status='approved') then
    raise exception 'pc_link_revoke_denied' using errcode='42501';
  end if;
  perform 1 from public.freept_pc_device_links l
    where l.auth_user_id=p_auth_user_id and l.profile_id=v_profile
      and l.revoked_at is null for update;
  if not found then return false; end if;
  -- Lock only devices enrolled by this PC; never touch the Android Bridge.
  perform 1 from public.bridge_devices d
    where d.owner_id=v_profile and d.owner_auth_user_id=p_auth_user_id
    order by d.id for update;
  update public.bridge_grants g
    set revoked_at=greatest(clock_timestamp(),g.approved_at)
    from public.bridge_devices d
    where d.id=g.device_id and d.owner_id=v_profile
      and d.owner_auth_user_id=p_auth_user_id and g.revoked_at is null;
  update public.bridge_devices d
    set bridge_enabled=false,updated_at=clock_timestamp()
    where d.owner_id=v_profile and d.owner_auth_user_id=p_auth_user_id
      and d.bridge_enabled;
  update public.freept_pc_device_links
    set revoked_at=clock_timestamp()
    where auth_user_id=p_auth_user_id and profile_id=v_profile
      and revoked_at is null;
  return found;
end;
$$;
revoke all on function public.freept_pc_link_revoke(uuid) from public, anon;
grant execute on function public.freept_pc_link_revoke(uuid) to authenticated;

-- Owner-visible Bridge queries and controls use the canonical profile identity,
-- while the trusted enrollment server records which Auth session created each
-- desktop device so Android can revoke it without disabling its own Bridge.
alter table public.bridge_devices
  add column if not exists owner_auth_user_id uuid references auth.users(id) on delete cascade;

create or replace function public.bridge_owner_set_enabled(
  p_device_id uuid,p_enabled boolean
) returns void language plpgsql security definer set search_path=''
as $$
declare v_owner uuid := (select public.freept_current_profile_id());
begin
  if (select auth.uid()) is null or not (select public.freept_is_approved()) then
    raise exception 'bridge_owner_not_approved' using errcode='42501';
  end if;
  if p_device_id is null or p_enabled is null then
    raise exception 'invalid_bridge_request' using errcode='22023';
  end if;
  perform 1 from public.bridge_devices
    where id=p_device_id and owner_id=v_owner for update;
  if not found then raise exception 'bridge_owner_required' using errcode='42501'; end if;
  update public.bridge_devices set bridge_enabled=p_enabled,updated_at=clock_timestamp()
    where id=p_device_id;
end;
$$;

create or replace function public.bridge_owner_grant(
  p_device_id uuid,p_receiver_id uuid
) returns void language plpgsql security definer set search_path=''
as $$
declare v_owner uuid := (select public.freept_current_profile_id());
begin
  if (select auth.uid()) is null or not (select public.freept_is_approved()) then
    raise exception 'bridge_owner_not_approved' using errcode='42501';
  end if;
  if p_device_id is null or p_receiver_id is null then
    raise exception 'invalid_bridge_request' using errcode='22023';
  end if;
  perform 1 from public.bridge_devices
    where id=p_device_id and owner_id=v_owner for update;
  if not found then raise exception 'bridge_owner_required' using errcode='42501'; end if;
  if not exists(select 1 from public.profiles p
      where p.id=p_receiver_id and p.role='admin' and p.status='approved') then
    raise exception 'bridge_receiver_not_admin' using errcode='42501';
  end if;
  insert into public.bridge_grants(device_id,receiver_id,approved_at,revoked_at)
    values(p_device_id,p_receiver_id,clock_timestamp(),null)
    on conflict(device_id,receiver_id) do update
      set approved_at=excluded.approved_at,revoked_at=null;
end;
$$;

create or replace function public.bridge_owner_revoke(
  p_device_id uuid,p_receiver_id uuid
) returns void language plpgsql security definer set search_path=''
as $$
declare v_owner uuid := (select public.freept_current_profile_id());
begin
  if (select auth.uid()) is null or not (select public.freept_is_approved()) then
    raise exception 'bridge_owner_not_approved' using errcode='42501';
  end if;
  if p_device_id is null or p_receiver_id is null then
    raise exception 'invalid_bridge_request' using errcode='22023';
  end if;
  perform 1 from public.bridge_devices
    where id=p_device_id and owner_id=v_owner for update;
  if not found then raise exception 'bridge_owner_required' using errcode='42501'; end if;
  update public.bridge_grants set revoked_at=greatest(clock_timestamp(),approved_at)
    where device_id=p_device_id and receiver_id=p_receiver_id and revoked_at is null;
end;
$$;

create or replace function public.bridge_owner_activate_family(p_device_id uuid)
returns uuid language plpgsql security definer set search_path=''
as $$
declare
  v_owner uuid := (select public.freept_current_profile_id());
  v_admins uuid[];
  v_receiver uuid;
begin
  if (select auth.uid()) is null or not (select public.freept_is_approved()) then
    raise exception 'bridge_owner_not_approved' using errcode='42501';
  end if;
  if p_device_id is null then
    raise exception 'bridge_invalid_device' using errcode='22023';
  end if;
  perform 1 from public.bridge_devices d
    where d.id=p_device_id and d.owner_id=v_owner for update;
  if not found then raise exception 'bridge_owner_required' using errcode='42501'; end if;
  select array_agg(p.id order by p.id) into v_admins from public.profiles p
    where p.role='admin' and p.status='approved';
  if coalesce(array_length(v_admins,1),0)<>1 then
    raise exception 'bridge_unique_admin_required' using errcode='42501';
  end if;
  v_receiver:=v_admins[1];
  insert into public.bridge_grants(device_id,receiver_id,approved_at,revoked_at)
    values(p_device_id,v_receiver,clock_timestamp(),null)
    on conflict(device_id,receiver_id) do update
      set approved_at=excluded.approved_at,revoked_at=null;
  update public.bridge_devices set bridge_enabled=true,updated_at=clock_timestamp()
    where id=p_device_id and owner_id=v_owner;
  return v_receiver;
end;
$$;
revoke all on function public.bridge_owner_set_enabled(uuid,boolean) from public,anon;
revoke all on function public.bridge_owner_grant(uuid,uuid) from public,anon;
revoke all on function public.bridge_owner_revoke(uuid,uuid) from public,anon;
revoke all on function public.bridge_owner_activate_family(uuid) from public,anon;
grant execute on function public.bridge_owner_set_enabled(uuid,boolean) to authenticated;
grant execute on function public.bridge_owner_grant(uuid,uuid) to authenticated;
grant execute on function public.bridge_owner_revoke(uuid,uuid) to authenticated;
grant execute on function public.bridge_owner_activate_family(uuid) to authenticated;

create or replace function public.bridge_server_enroll_device(
  p_device_id uuid,p_owner_id uuid,p_owner_auth_user_id uuid,p_label text,
  p_salt_hex text,p_verifier_hex text
) returns uuid language plpgsql security invoker set search_path=''
as $$
begin
  if p_device_id is null or p_owner_id is null or p_owner_auth_user_id is null
     or p_label is null or char_length(p_label) not between 1 and 100
     or p_label ~ '[[:cntrl:]]'
     or p_salt_hex is null or p_salt_hex !~ '^[0-9a-f]{32}$'
     or p_verifier_hex is null or p_verifier_hex !~ '^[0-9a-f]{64}$' then
    raise exception 'bridge_device_enrollment_invalid' using errcode='22023';
  end if;
  perform 1 from public.profiles p
    where p.id=p_owner_id and p.status='approved' for update;
  if not found then raise exception 'bridge_device_owner_denied' using errcode='42501'; end if;
  if p_owner_auth_user_id<>p_owner_id then
    perform 1 from public.freept_pc_device_links l
      where l.auth_user_id=p_owner_auth_user_id and l.profile_id=p_owner_id
        and l.revoked_at is null for share;
    if not found then raise exception 'bridge_device_owner_denied' using errcode='42501'; end if;
  end if;
  if (select count(*) from public.bridge_devices where owner_id=p_owner_id)>=5 then
    raise exception 'bridge_device_limit' using errcode='23514';
  end if;
  insert into public.bridge_devices(id,owner_id,owner_auth_user_id,label,bridge_enabled)
    values(p_device_id,p_owner_id,p_owner_auth_user_id,p_label,false);
  insert into public.bridge_device_verifiers(device_id,salt_hex,verifier_hex)
    values(p_device_id,p_salt_hex,p_verifier_hex);
  return p_device_id;
end;
$$;
revoke all on function public.bridge_server_enroll_device(uuid,uuid,uuid,text,text,text)
  from public,anon,authenticated;
grant execute on function public.bridge_server_enroll_device(uuid,uuid,uuid,text,text,text)
  to service_role;

-- Keep the existing Android server call compatible; its Auth id is its profile id.
create or replace function public.bridge_server_enroll_device(
  p_device_id uuid,p_owner_id uuid,p_label text,p_salt_hex text,p_verifier_hex text
) returns uuid language sql security invoker set search_path=''
as $$
  select public.bridge_server_enroll_device(
    p_device_id,p_owner_id,p_owner_id,p_label,p_salt_hex,p_verifier_hex);
$$;
revoke all on function public.bridge_server_enroll_device(uuid,uuid,text,text,text)
  from public,anon,authenticated;
grant execute on function public.bridge_server_enroll_device(uuid,uuid,text,text,text)
  to service_role;
