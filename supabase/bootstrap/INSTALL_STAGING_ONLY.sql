-- Additive bootstrap v1, isolated test project ONLY. No existing policy changed.
-- Trusted gateway validates ECDSA before this service-role-only invoker API.
begin;
create table public.bridge_bootstrap_devices (
 id uuid primary key,
 public_key text not null check(length(public_key) between 100 and 164),
 pair_hash text not null unique check(pair_hash ~ '^[0-9a-f]{64}$'),
 challenge text not null check(challenge ~ '^[0-9a-f]{64}$'),
 admin_id uuid references public.profiles(id),
 owner_id uuid references public.profiles(id),
 received integer not null default 0 check(received between 0 and 300000),
 sha256 text,
 verified_at timestamptz,
 revoked_at timestamptz,
 expires_at timestamptz not null default (now()+interval '15 minutes'),
 created_at timestamptz not null default now()
);
create table public.bridge_bootstrap_nonces (
 device_id uuid not null references public.bridge_bootstrap_devices(id) on delete cascade,
 nonce text not null check(nonce ~ '^[0-9a-f]{32}$'),
 created_at timestamptz not null default now(),
 primary key(device_id,nonce)
);
alter table public.bridge_bootstrap_devices enable row level security;
alter table public.bridge_bootstrap_nonces enable row level security;
revoke all on public.bridge_bootstrap_devices,public.bridge_bootstrap_nonces from public,anon,authenticated;
grant all on public.bridge_bootstrap_devices,public.bridge_bootstrap_nonces to service_role;
create function public.bridge_bootstrap_step(p_action text,p_id uuid,p_key text,p_nonce text,p_data jsonb,p_actor uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare d public.bridge_bootstrap_devices; a uuid;
begin
 if p_action='approve' then
  perform 1 from public.profiles where id=p_actor and role='admin' and status='approved' for share;
  if not found then raise exception 'bootstrap_denied'; end if;
  select * into d from public.bridge_bootstrap_devices where pair_hash=p_data->>'pairHash' for update;
  if d.id is null or d.expires_at<=now() or d.revoked_at is not null or d.owner_id is not null or d.admin_id is not null then raise exception 'bootstrap_denied'; end if;
  update public.bridge_bootstrap_devices set admin_id=p_actor where id=d.id;
  return jsonb_build_object('approved',true,'deviceId',d.id);
 end if;
 if p_action='start' then
  -- Bounded global pending inventory: no unbounded anonymous database growth.
  perform pg_catalog.pg_advisory_xact_lock(20261119,1);
  delete from public.bridge_bootstrap_devices where expires_at<=now() and owner_id is null;
  if (select count(*) from public.bridge_bootstrap_devices where expires_at>now() and owner_id is null)>=100 then raise exception 'bootstrap_capacity'; end if;
  insert into public.bridge_bootstrap_devices(id,public_key,pair_hash,challenge)
   values(p_id,p_key,p_data->>'pairHash',p_data->>'challenge') on conflict(id) do nothing;
 end if;
 select * into d from public.bridge_bootstrap_devices where id=p_id for update;
 if d.id is null then raise exception 'bootstrap_denied'; end if;
 if p_action='revoke' then
  perform 1 from public.profiles where id=p_actor and role='admin' and status='approved' for share;
  if not found or d.admin_id is distinct from p_actor then raise exception 'bootstrap_denied'; end if;
  update public.bridge_bootstrap_devices set revoked_at=now() where id=d.id;
  -- Also revoke a device already promoted to the existing Bridge.
  update public.bridge_devices set bridge_enabled=false where id=d.id;
  update public.bridge_grants set revoked_at=now() where device_id=d.id and revoked_at is null;
  return jsonb_build_object('revoked',true);
 end if;
 if d.public_key is distinct from p_key or d.revoked_at is not null or d.expires_at<=now() then raise exception 'bootstrap_denied'; end if;
 if p_nonce is null or p_nonce !~ '^[0-9a-f]{32}$' then raise exception 'bootstrap_denied'; end if;
 -- Atomic anti-replay, common to every gateway process.
 insert into public.bridge_bootstrap_nonces(device_id,nonce) values(d.id,p_nonce);
 delete from public.bridge_bootstrap_nonces where device_id=d.id and created_at<now()-interval '2 minutes';
 if p_action='cancel' then
  if d.owner_id is not null then raise exception 'bootstrap_denied'; end if;
  update public.bridge_bootstrap_devices set revoked_at=now() where id=d.id;
  return jsonb_build_object('cancelled',true);
 end if;
 if d.admin_id is not null then
  perform 1 from public.profiles where id=d.admin_id and role='admin' and status='approved' for share;
  if not found then raise exception 'bootstrap_denied'; end if;
 end if;
 if p_action='start' then return jsonb_build_object('state',case when d.admin_id is null then 'pending' else 'approved' end); end if;
 if d.admin_id is null then return jsonb_build_object('state','pending'); end if;
 if p_action='poll' then
  if d.owner_id is not null then return jsonb_build_object('state','bound'); end if;
  if d.verified_at is not null then return jsonb_build_object('state','verified','sha256',d.sha256); end if;
  return jsonb_build_object('state','approved','job',jsonb_build_object('operation','diagnostic','challenge',d.challenge,'offset',d.received,'size',300000,'length',least(262144,300000-d.received)));
 end if;
 if p_action='chunk' then
  if d.owner_id is not null or d.verified_at is not null or (p_data->>'offset')::integer<>d.received or
    (p_data->>'length')::integer<>least(262144,300000-d.received) or
    p_data->>'sha256' !~ '^[0-9a-f]{64}$' then raise exception 'bootstrap_denied'; end if;
  update public.bridge_bootstrap_devices set received=received+(p_data->>'length')::integer,
    verified_at=case when received+(p_data->>'length')::integer=300000 then now() else null end,
    sha256=p_data->>'sha256',
    expires_at=case when received+(p_data->>'length')::integer=300000 then now()+interval '24 hours' else expires_at end
    where id=d.id returning * into d;
  return jsonb_build_object('state',case when d.verified_at is null then 'transferring' else 'verified' end,'received',d.received,'sha256',d.sha256);
 end if;
 if p_action='status' then return jsonb_build_object('state',case when d.owner_id is not null then 'bound' when d.verified_at is not null then 'verified' else 'approved' end,'sha256',d.sha256); end if;
 if p_action='claim' then
  if d.verified_at is null or d.received<>300000 or p_actor is null or
    (d.owner_id is not null and d.owner_id<>p_actor) then raise exception 'bootstrap_denied'; end if;
  perform 1 from public.profiles where id=p_actor and role='user' and status='approved' for update;
  if not found then raise exception 'bootstrap_denied'; end if;
  if d.owner_id is not null then return jsonb_build_object('bound',true,'deviceId',d.id); end if;
  if (select count(*) from public.bridge_devices where owner_id=p_actor)>=5 then raise exception 'bootstrap_denied'; end if;
  insert into public.bridge_devices(id,owner_id,label,bridge_enabled) values(d.id,p_actor,'Telefono FreePT',true);
  insert into public.bridge_device_verifiers(device_id,salt_hex,verifier_hex) values(d.id,p_data->>'salt',p_data->>'verifier');
  insert into public.bridge_grants(device_id,receiver_id) values(d.id,d.admin_id);
  update public.bridge_bootstrap_devices set owner_id=p_actor where id=d.id;
  return jsonb_build_object('bound',true,'deviceId',d.id);
 end if;
 raise exception 'bootstrap_denied';
end; $$;
revoke all on function public.bridge_bootstrap_step(text,uuid,text,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.bridge_bootstrap_step(text,uuid,text,text,jsonb,uuid) to service_role;
commit;
