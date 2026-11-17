-- STAGING ONLY, ADDITIVE. Apply after bridge_device_verifiers and
-- bridge_job_revocation_fence. No external Supabase deployment.
-- TX possession MUST be established by the trusted backend with a fresh
-- verified device secret BEFORE invoking bridge_server_open_tx_session.
-- The database compares against its current device verifier and atomically
-- supersedes the previous session. Hashes are domain-separated by Node.
-- This is an authentication-state primitive, NOT a public TX API.

create table if not exists public.bridge_tx_sessions (
  device_id uuid primary key references public.bridge_devices(id) on delete cascade,
  token_hash_hex text not null check (token_hash_hex ~ '^[0-9a-f]{64}$'),
  verifier_hex text not null check (verifier_hex ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  check (expires_at > created_at)
);
create unique index if not exists bridge_tx_sessions_token_hash_idx
  on public.bridge_tx_sessions(token_hash_hex);
alter table public.bridge_tx_sessions enable row level security;
revoke all on public.bridge_tx_sessions from public, anon, authenticated;
-- No client policies. The server-role backend owns all TX session calls.

create or replace function public.bridge_server_open_tx_session(
  p_device_id uuid, p_token_hash_hex text, p_verifier_hex text
) returns timestamptz language plpgsql security invoker set search_path = ''
as $$
declare
  v_expires timestamptz;
begin
  if p_device_id is null or p_token_hash_hex is null or
     p_token_hash_hex !~ '^[0-9a-f]{64}$' or p_verifier_hex is null or
     p_verifier_hex !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_tx_session' using errcode='22023';
  end if;
  perform 1 from public.bridge_devices d
    where d.id=p_device_id and d.bridge_enabled=true for update;
  if not found then
    raise exception 'bridge_unavailable' using errcode='42501';
  end if;
  -- The backend must have authenticated the raw device secret; a hash
  -- supplied by an arbitrary caller is never sufficient proof of possession.
  if not exists(
    select 1 from public.bridge_device_verifiers v
      where v.device_id=p_device_id and v.verifier_hex=p_verifier_hex
  ) then
    raise exception 'bridge_tx_verifier_mismatch' using errcode='42501';
  end if;
  v_expires := clock_timestamp() + interval '5 minutes';
  insert into public.bridge_tx_sessions (
    device_id,token_hash_hex,verifier_hex,expires_at
  ) values (p_device_id,p_token_hash_hex,p_verifier_hex,v_expires)
  on conflict(device_id) do update
    set token_hash_hex=excluded.token_hash_hex,
        verifier_hex=excluded.verifier_hex,
        created_at=clock_timestamp(),expires_at=excluded.expires_at;
  -- Old delivered jobs must not complete under a newly opened session.
  update public.bridge_jobs
    set state='cancelled',session_binding_hex=null,
        updated_at=clock_timestamp()
    where device_id=p_device_id and state='sent';
  return v_expires;
end;
$$;

create or replace function public.bridge_server_assert_tx_session(
  p_device_id uuid, p_token_hash_hex text
) returns text language plpgsql security invoker set search_path = ''
as $$
declare
  v_hash text;
begin
  if p_device_id is null or p_token_hash_hex is null or
     p_token_hash_hex !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_tx_session' using errcode='22023';
  end if;
  perform 1 from public.bridge_devices d
    where d.id=p_device_id and d.bridge_enabled=true for update;
  if not found then
    raise exception 'bridge_unavailable' using errcode='42501';
  end if;
  select s.token_hash_hex into v_hash
    from public.bridge_tx_sessions s
    join public.bridge_device_verifiers v on v.device_id=s.device_id
      and v.verifier_hex=s.verifier_hex
    where s.device_id=p_device_id
      and s.token_hash_hex=p_token_hash_hex
      and s.expires_at>clock_timestamp()
    for update of s;
  if not found then
    raise exception 'bridge_tx_session_denied' using errcode='42501';
  end if;
  return v_hash;
end;
$$;

create or replace function public.bridge_server_close_tx_session(
  p_device_id uuid, p_token_hash_hex text
) returns boolean language plpgsql security invoker set search_path = ''
as $$
declare
  v_removed integer;
begin
  if p_device_id is null or p_token_hash_hex is null or
     p_token_hash_hex !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_tx_session' using errcode='22023';
  end if;
  perform 1 from public.bridge_devices d
    where d.id=p_device_id for update;
  if not found then return false; end if;
  delete from public.bridge_tx_sessions
    where device_id=p_device_id and token_hash_hex=p_token_hash_hex;
  get diagnostics v_removed = row_count;
  if v_removed=1 then
    update public.bridge_jobs
      set state='cancelled',session_binding_hex=null,
          updated_at=clock_timestamp()
      where device_id=p_device_id and state='sent'
        and session_binding_hex=p_token_hash_hex;
    return true;
  end if;
  return false;
end;
$$;

-- Owner OFF and verifier rotation/deletion invalidate sessions at commit.
-- Changing the grant receiver alone cancels their jobs, not TX device auth.
create or replace function public.bridge_drop_tx_session_on_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_table_name='bridge_devices' and tg_op='UPDATE' then
    if old.bridge_enabled=true and new.bridge_enabled=false then
      delete from public.bridge_tx_sessions where device_id=new.id;
    end if;
  elsif tg_table_name='bridge_device_verifiers' then
    if tg_op='DELETE' then
      delete from public.bridge_tx_sessions where device_id=old.device_id;
    elsif old.verifier_hex is distinct from new.verifier_hex
       or old.salt_hex is distinct from new.salt_hex then
      delete from public.bridge_tx_sessions where device_id=new.device_id;
    end if;
  end if;
  return coalesce(new,old);
end;
$$;
revoke all on function public.bridge_drop_tx_session_on_change()
  from public, anon, authenticated;
drop trigger if exists bridge_drop_session_owner_off on public.bridge_devices;
create trigger bridge_drop_session_owner_off
  after update of bridge_enabled on public.bridge_devices
  for each row execute function public.bridge_drop_tx_session_on_change();
drop trigger if exists bridge_drop_session_verifier_rotation
  on public.bridge_device_verifiers;
create trigger bridge_drop_session_verifier_rotation
  after update or delete on public.bridge_device_verifiers
  for each row execute function public.bridge_drop_tx_session_on_change();

revoke all on function public.bridge_server_open_tx_session(uuid,text,text)
  from public,anon,authenticated;
revoke all on function public.bridge_server_assert_tx_session(uuid,text)
  from public,anon,authenticated;
revoke all on function public.bridge_server_close_tx_session(uuid,text)
  from public,anon,authenticated;
grant execute on function public.bridge_server_open_tx_session(uuid,text,text)
  to service_role;
grant execute on function public.bridge_server_assert_tx_session(uuid,text)
  to service_role;
grant execute on function public.bridge_server_close_tx_session(uuid,text)
  to service_role;
