-- FreePT production Bridge readiness - READ ONLY.
-- Safe to run on production. Does not install or modify any schema or data.
-- This is a prerequisite check, NOT authorization to run staging migrations.
WITH checks AS (
 SELECT 'FreePT profiles table' AS item, to_regclass('public.profiles') IS NOT NULL AS ok
 UNION ALL SELECT 'FreePT admin identity function',to_regprocedure('public.freept_is_admin()') IS NOT NULL
 UNION ALL SELECT 'FreePT approved identity function',to_regprocedure('public.freept_is_approved()') IS NOT NULL
 UNION ALL SELECT 'Bridge devices absent (fresh install)',to_regclass('public.bridge_devices') IS NULL
 UNION ALL SELECT 'Bridge grants absent (fresh install)',to_regclass('public.bridge_grants') IS NULL
 UNION ALL SELECT 'Bridge verifier table absent (fresh install)',to_regclass('public.bridge_device_verifiers') IS NULL
 UNION ALL SELECT 'Bridge jobs absent (fresh install)',to_regclass('public.bridge_jobs') IS NULL
 UNION ALL SELECT 'Bridge sessions absent (fresh install)',to_regclass('public.bridge_tx_sessions') IS NULL
 UNION ALL SELECT 'Bridge audit absent (fresh install)',to_regclass('public.bridge_audit_events') IS NULL
)
SELECT item, CASE WHEN ok THEN 'OK' ELSE 'REVIEW REQUIRED' END AS result FROM checks ORDER BY item;
