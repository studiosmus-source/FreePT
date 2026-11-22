-- Disposable PostgreSQL fixture for the PC account-linking integration test.
-- NEVER apply to Supabase or any user database.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema auth;
create schema storage;

create table auth.users(
  id uuid primary key,
  is_anonymous boolean not null default true
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;

create table public.profiles(
  id uuid primary key,
  full_name text not null,
  phone text not null unique,
  role text not null check(role in ('user','admin')),
  status text not null check(status in ('pending','approved','blocked')),
  created_at timestamptz not null default now()
);
create function public.freept_is_approved() returns boolean
language sql stable security definer set search_path=''
as $$select exists(select 1 from public.profiles p
  where p.id=(select auth.uid()) and p.status='approved')$$;
create function public.freept_is_admin() returns boolean
language sql stable security definer set search_path=''
as $$select exists(select 1 from public.profiles p
  where p.id=(select auth.uid()) and p.role='admin' and p.status='approved')$$;
grant execute on function public.freept_is_approved() to authenticated;
grant execute on function public.freept_is_admin() to authenticated;

create table public.messages(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  sender_id uuid not null references public.profiles(id),
  body text not null default '',
  file_path text,
  file_name text,
  created_at timestamptz not null default now(),
  check(length(body)>0 or file_path is not null)
);
alter table public.profiles enable row level security;
alter table public.messages enable row level security;
grant usage on schema public to authenticated;
grant select on public.profiles,public.messages to authenticated;
grant insert on public.messages to authenticated;
create policy "profiles read" on public.profiles for select to authenticated
  using(id=(select auth.uid()) or (select public.freept_is_admin()));
create policy "messages read" on public.messages for select to authenticated
  using((select public.freept_is_admin()) or
    (user_id=(select auth.uid()) and (select public.freept_is_approved())));
create policy "messages write" on public.messages for insert to authenticated
  with check(sender_id=(select auth.uid()) and
    (select public.freept_is_approved()) and
    ((select public.freept_is_admin()) or user_id=(select auth.uid())));

create table storage.buckets(id text primary key,name text not null,public boolean not null default false);
create table storage.objects(
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets(id),
  name text not null
);
create function storage.foldername(name text) returns text[]
language sql immutable as $$select string_to_array(name,'/')$$;
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated;
grant select,insert on storage.objects to authenticated;
insert into storage.buckets(id,name,public) values('attachments','attachments',false);
create policy "attachments read" on storage.objects for select to authenticated
  using(bucket_id='attachments' and
    ((select public.freept_is_admin()) or
      ((select public.freept_is_approved()) and
        (storage.foldername(name))[1]=(select auth.uid())::text)));
create policy "attachments upload" on storage.objects for insert to authenticated
  with check(bucket_id='attachments' and
    (select public.freept_is_approved()) and
    ((select public.freept_is_admin()) or
      (storage.foldername(name))[1]=(select auth.uid())::text));

insert into auth.users(id,is_anonymous) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc',true),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd',true);
insert into public.profiles(id,full_name,phone,role,status) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Phone user','+390000000001','user','approved'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Admin','+390000000002','admin','approved'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','Other user','+390000000003','user','approved');
insert into public.messages(user_id,sender_id,body)
  values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
         'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Existing chat message');
insert into storage.objects(bucket_id,name)
  values('attachments','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/existing/file.txt');
