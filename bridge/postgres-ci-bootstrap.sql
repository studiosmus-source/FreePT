-- Disposable PostgreSQL CI bootstrap. NEVER apply to a real Supabase project.
-- Implements only the public.profiles/auth.uid API surface required by Bridge.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema if not exists auth;
create table public.profiles (
  id uuid primary key,
  role text not null check(role in ('user','admin')),
  status text not null check(status in ('pending','approved','blocked'))
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid
$$;
create function public.freept_is_approved() returns boolean language sql stable
as $$select exists(select 1 from public.profiles where id=auth.uid() and status='approved')$$;
create function public.freept_is_admin() returns boolean language sql stable
as $$select exists(select 1 from public.profiles where id=auth.uid() and role='admin' and status='approved')$$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
grant select on public.profiles to authenticated;
insert into public.profiles(id,role,status) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','user','approved'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','admin','approved'),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','user','approved');
