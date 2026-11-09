# FreePT Bridge — production migration gate

Source reviewed: branch `feature/bridge-chunk-receiver-20261108`, commit `49ba237cd82752f362738b3d70f39d6874d3b648`.

## Verified evidence
- User-run production read-only prerequisite SQL returned 9/9 OK (2026-11-09).
- User-run Bridge schema check returned 36/36 DA CONFIGURARE: Bridge objects not installed.
- Render production Bridge service is live; this is NOT a database integration test.
- Existing `supabase/bridge_staging_install_once.sql` explicitly forbids production and targets a different Supabase project.
- Its 14 sections include SECURITY DEFINER functions, explicit role grants/revokes, RLS policies, triggers and references to public.profiles.
- Staging bundle is 79,542 characters and includes destructive statements against Bridge-only rows in stored function bodies. These need review before production release.

## Release gate — not yet passed
1. Review each migration's security-definer search_path, EXECUTE grants, auth.uid() checks, RLS, and service-role-only RPCs.
2. Verify function signatures, trigger ordering, table constraints, and cross-file overrides against the current HEAD.
3. Build a separate production-only transaction with exact project guard, clean-install guard, prerequisite checks, and rollback on failure. Do not reuse staging-labeled SQL unmodified.
4. Validate against disposable PostgreSQL/Supabase test environment and run all 36 Bridge preflight checks there.
5. Obtain verified production backup/recovery plan and explicit user approval before applying to the production database.
6. Re-run read-only checks after install; exercise authenticated Bridge flow without affecting existing chat/user data.
7. Only then enable production APK endpoint and compile/test the unified Android APK.

**Current state:** NOT approved for production SQL execution. Do not run the staging installer on the production project.
