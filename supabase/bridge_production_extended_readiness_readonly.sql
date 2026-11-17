-- FreePT Bridge production: expanded READ-ONLY deployment gate.
-- Run ONLY in the intended Supabase project SQL Editor.
-- This does NOT install Bridge or authorize a production deployment.
-- Project identity must be verified manually in the Supabase dashboard.
WITH required_identity AS (
 SELECT 'public.profiles exists' AS item, to_regclass('public.profiles') IS NOT NULL AS ok
 UNION ALL SELECT 'public.profiles.id exists',
   EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='id')
 UNION ALL SELECT 'public.profiles.role exists',
   EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='role')
 UNION ALL SELECT 'public.profiles.status exists',
   EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='status')
 UNION ALL SELECT 'public.freept_is_admin() exists',
   to_regprocedure('public.freept_is_admin()') IS NOT NULL
 UNION ALL SELECT 'public.freept_is_approved() exists',
   to_regprocedure('public.freept_is_approved()') IS NOT NULL
), bridge_objects AS (
 SELECT 'No existing Bridge relations (clean install)' AS item,
   NOT EXISTS (
     SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname LIKE 'bridge_%'
       AND c.relkind IN ('r','p','v','m','S','f')
   ) AS ok
 UNION ALL SELECT 'No existing Bridge functions (clean install)',
   NOT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname LIKE 'bridge_%'
   )
 UNION ALL SELECT 'No existing Bridge types (clean install)',
   NOT EXISTS (
     SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
     WHERE n.nspname='public' AND t.typname LIKE 'bridge_%'
   )
)
SELECT item, CASE WHEN ok THEN 'OK' ELSE 'STOP / REVIEW' END AS result
FROM (SELECT * FROM required_identity UNION ALL SELECT * FROM bridge_objects) checks
ORDER BY item;
