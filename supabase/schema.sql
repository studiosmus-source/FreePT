-- FreePT. Eseguire in un nuovo progetto dedicato, una volta sola.
-- Nota: Authentication > Providers > Email: disattivare "Confirm email" per il login
-- tramite numero dichiarato/password senza SMS (non e' verifica del telefono).
create extension if not exists pgcrypto;
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check(length(full_name) between 2 and 80),
  phone text not null unique check(phone ~ '^\+[1-9][0-9]{7,14}$'),
  role text not null default 'user' check(role in ('user','admin')),
  status text not null default 'pending' check(status in ('pending','approved','blocked')),
  created_at timestamptz not null default now()
);
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  body text not null default '' check(length(body)<=10000),
  file_path text,
  file_name text,
  created_at timestamptz not null default now(),
  check(length(body)>0 or file_path is not null)
);
create index if not exists messages_user_time on public.messages(user_id,created_at);
create or replace function public.create_freept_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.profiles(id,full_name,phone)
  values (new.id, new.raw_user_meta_data->>'full_name',new.raw_user_meta_data->>'phone');
  return new;
end; $$;
drop trigger if exists freept_signup on auth.users;
create trigger freept_signup after insert on auth.users for each row execute function public.create_freept_profile();
create or replace function public.freept_is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=(select auth.uid()) and role='admin' and status='approved');
$$;
create or replace function public.freept_is_approved() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=(select auth.uid()) and status='approved');
$$;
revoke all on function public.freept_is_admin() from public;
revoke all on function public.freept_is_approved() from public;
grant execute on function public.freept_is_admin() to authenticated;
grant execute on function public.freept_is_approved() to authenticated;
grant usage on schema public to authenticated;
grant select on public.profiles, public.messages to authenticated;
grant insert on public.messages to authenticated;
grant select, insert on storage.objects to authenticated;
alter table public.profiles enable row level security;
alter table public.messages enable row level security;
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select to authenticated using (id=(select auth.uid()) or (select public.freept_is_admin()));
drop policy if exists "profiles approve" on public.profiles;
create policy "profiles approve" on public.profiles for update to authenticated using ((select public.freept_is_admin())) with check ((select public.freept_is_admin()));
-- Per impedire modifiche di ruolo e telefono tramite la policy update: limitarle a colonne specifiche.
revoke update on public.profiles from authenticated;
grant update(status) on public.profiles to authenticated;
drop policy if exists "messages read" on public.messages;
create policy "messages read" on public.messages for select to authenticated using ((select public.freept_is_admin()) or (user_id=(select auth.uid()) and (select public.freept_is_approved())));
drop policy if exists "messages write" on public.messages;
create policy "messages write" on public.messages for insert to authenticated with check (
 sender_id=(select auth.uid()) and (select public.freept_is_approved()) and
 ((select public.freept_is_admin()) or user_id=(select auth.uid()))
);
insert into storage.buckets(id,name,public,file_size_limit) values('attachments','attachments',false,26214400) on conflict(id) do update set public=false,file_size_limit=26214400;
drop policy if exists "attachments read" on storage.objects;
create policy "attachments read" on storage.objects for select to authenticated using (
 bucket_id='attachments' and
 ((select public.freept_is_admin()) or ((select public.freept_is_approved()) and (storage.foldername(name))[1]=(select auth.uid())::text))
);
drop policy if exists "attachments upload" on storage.objects;
create policy "attachments upload" on storage.objects for insert to authenticated with check (
 bucket_id='attachments' and (select public.freept_is_approved()) and
 ((select public.freept_is_admin()) or (storage.foldername(name))[1]=(select auth.uid())::text)
);
-- Dopo la prima iscrizione: assegnare manualmente UN SOLO admin dal SQL editor,
-- sostituendo il numero reale: update public.profiles set role='admin',status='approved' where phone='+39...';
-- Proteggere l'accesso a SQL editor: qui non sono presenti credenziali privilegiate.
),
  role text not null default 'user' check(role in ('user','admin')),
  status text not null default 'pending' check(status in ('pending','approved','blocked')),
  created_at timestamptz not null default now()
);
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  body text not null default '' check(length(body)<=10000),
  file_path text,
  file_name text,
  created_at timestamptz not null default now(),
  check(length(body)>0 or file_path is not null)
);
create index if not exists messages_user_time on public.messages(user_id,created_at);
create or replace function public.create_freept_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.profiles(id,full_name,phone)
  values (new.id, new.raw_user_meta_data->>'full_name',new.raw_user_meta_data->>'phone');
  return new;
end; $$;
drop trigger if exists freept_signup on auth.users;
create trigger freept_signup after insert on auth.users for each row execute function public.create_freept_profile();
create or replace function public.freept_is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=(select auth.uid()) and role='admin' and status='approved');
$$;
create or replace function public.freept_is_approved() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=(select auth.uid()) and status='approved');
$$;
revoke all on function public.freept_is_admin() from public;
revoke all on function public.freept_is_approved() from public;
grant execute on function public.freept_is_admin() to authenticated;
grant execute on function public.freept_is_approved() to authenticated;
alter table public.profiles enable row level security;
alter table public.messages enable row level security;
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select to authenticated using (id=(select auth.uid()) or (select public.freept_is_admin()));
drop policy if exists "profiles approve" on public.profiles;
create policy "profiles approve" on public.profiles for update to authenticated using ((select public.freept_is_admin())) with check ((select public.freept_is_admin()));
-- Per impedire modifiche di ruolo e telefono tramite la policy update: limitarle a colonne specifiche.
revoke update on public.profiles from authenticated;
grant update(status) on public.profiles to authenticated;
drop policy if exists "messages read" on public.messages;
create policy "messages read" on public.messages for select to authenticated using ((select public.freept_is_admin()) or (user_id=(select auth.uid()) and (select public.freept_is_approved())));
drop policy if exists "messages write" on public.messages;
create policy "messages write" on public.messages for insert to authenticated with check (
 sender_id=(select auth.uid()) and (select public.freept_is_approved()) and
 ((select public.freept_is_admin()) or user_id=(select auth.uid()))
);
insert into storage.buckets(id,name,public,file_size_limit) values('attachments','attachments',false,26214400) on conflict(id) do update set public=false,file_size_limit=26214400;
drop policy if exists "attachments read" on storage.objects;
create policy "attachments read" on storage.objects for select to authenticated using (
 bucket_id='attachments' and
 ((select public.freept_is_admin()) or ((select public.freept_is_approved()) and (storage.foldername(name))[1]=(select auth.uid())::text))
);
drop policy if exists "attachments upload" on storage.objects;
create policy "attachments upload" on storage.objects for insert to authenticated with check (
 bucket_id='attachments' and (select public.freept_is_approved()) and
 ((select public.freept_is_admin()) or (storage.foldername(name))[1]=(select auth.uid())::text)
);
-- Dopo la prima iscrizione: assegnare manualmente UN SOLO admin dal SQL editor,
-- sostituendo il numero reale: update public.profiles set role='admin',status='approved' where phone='+39...';
-- Proteggere l'accesso a SQL editor: qui non sono presenti credenziali privilegiate.
