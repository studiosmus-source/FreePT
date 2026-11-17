-- READ ONLY preflight: run on the actual FreePT Supabase project before the Bridge migration.
-- No CREATE/ALTER/DROP/INSERT/UPDATE/DELETE statements in this file.
select current_database() as database_name, current_user as sql_role, now() as checked_at;
select n.nspname as schema_name,c.relname as object_name,c.relkind as kind,c.relrowsecurity as rls_enabled
from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('profiles','messages','bridge_devices','bridge_requests')
order by c.relname;
select routine_name,routine_type from information_schema.routines
where routine_schema='public' and routine_name in ('freept_is_admin','freept_is_approved') order by routine_name;
select table_name,column_name,data_type from information_schema.columns
where table_schema='public' and table_name in ('profiles','bridge_devices','bridge_requests')
order by table_name,ordinal_position;
select tablename,policyname,cmd,roles,qual,with_check from pg_catalog.pg_policies
where schemaname='public' and tablename in ('profiles','messages','bridge_devices','bridge_requests')
order by tablename,policyname;
