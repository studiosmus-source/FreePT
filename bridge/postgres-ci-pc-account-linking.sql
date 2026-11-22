-- Disposable PostgreSQL integration test only. Never run against real accounts.
\set ON_ERROR_STOP on
BEGIN;

-- The new PC gets a distinct anonymous Auth id, but no separate FreePT profile.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','dddddddd-dddd-4ddd-8ddd-dddddddddddd',true);
DO $check$
BEGIN
  IF public.freept_current_profile_id() IS NOT NULL
     OR public.freept_is_approved() THEN
    RAISE EXCEPTION 'unpaired PC received a profile';
  END IF;
  IF has_table_privilege('authenticated','public.freept_pc_device_links','SELECT')
     OR has_table_privilege('authenticated','public.freept_pc_link_requests','SELECT')
     OR has_function_privilege('anon','public.freept_pc_link_approve(text)','EXECUTE') THEN
    RAISE EXCEPTION 'private pairing state is directly accessible';
  END IF;
END $check$;
SELECT public.freept_pc_link_start('PC Windows') AS pair_code \gset
RESET ROLE;

-- Only the approved phone profile can approve the temporary code.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
SELECT public.freept_pc_link_approve(:'pair_code') AS approved \gset
\if :approved
\else
\echo PC phone approval failed
\quit 1
\endif
SELECT public.freept_pc_link_approve(:'pair_code') AS approved_retry \gset
\if :approved_retry
\else
\echo lost-response approval retry was not idempotent
\quit 1
\endif
RESET ROLE;

-- The PC reads the existing profile, conversation and attachment namespace.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','dddddddd-dddd-4ddd-8ddd-dddddddddddd',true);
DO $check$
BEGIN
  IF public.freept_current_profile_id()<>'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
     OR NOT public.freept_is_approved() THEN
    RAISE EXCEPTION 'PC did not resolve to approved phone profile';
  END IF;
  IF (SELECT count(*) FROM public.profiles)<>1
     OR NOT EXISTS(SELECT 1 FROM public.profiles
       WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') THEN
    RAISE EXCEPTION 'PC profile RLS did not expose exactly the linked profile';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.messages
       WHERE body='Existing chat message') THEN
    RAISE EXCEPTION 'PC cannot read existing chat';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM storage.objects
       WHERE name='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/existing/file.txt') THEN
    RAISE EXCEPTION 'PC cannot read existing attachment namespace';
  END IF;
END $check$;
INSERT INTO public.messages(user_id,sender_id,body)
  VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
         'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','PC reply');
INSERT INTO storage.objects(bucket_id,name)
  VALUES('attachments','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/from-pc/file.txt');
DO $check$
BEGIN
  BEGIN
    INSERT INTO public.messages(user_id,sender_id,body)
      VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
             'dddddddd-dddd-4ddd-8ddd-dddddddddddd','forged sender');
    RAISE EXCEPTION 'PC forged an Auth id as sender';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $check$;
RESET ROLE;

-- PC Bridge device is recorded against the separate Auth session, but owned by
-- the existing profile. The phone can revoke exactly this PC without stopping
-- the Android-owned Bridge device.
SELECT public.bridge_server_enroll_device(
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'PC Windows',repeat('a',32),repeat('b',64));
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','dddddddd-dddd-4ddd-8ddd-dddddddddddd',true);
SELECT public.bridge_owner_activate_family('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
DO $check$
BEGIN
  IF (SELECT count(*) FROM public.freept_pc_link_list())<>1 THEN
    RAISE EXCEPTION 'phone cannot list its linked PC';
  END IF;
  IF NOT public.freept_pc_link_revoke('dddddddd-dddd-4ddd-8ddd-dddddddddddd') THEN
    RAISE EXCEPTION 'phone could not revoke PC';
  END IF;
END $check$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
SELECT public.freept_pc_link_approve(:'pair_code') AS stale_code_reapproved \gset
\if :stale_code_reapproved
\echo revoked PC pairing code reactivated a link
\quit 1
\endif
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','dddddddd-dddd-4ddd-8ddd-dddddddddddd',true);
DO $check$
BEGIN
  IF public.freept_current_profile_id() IS NOT NULL
     OR public.freept_is_approved()
     OR (SELECT count(*) FROM public.messages)<>0
     OR (SELECT count(*) FROM public.profiles)<>0 THEN
    RAISE EXCEPTION 'revoked PC retained chat or profile access';
  END IF;
END $check$;
RESET ROLE;
DO $check$
BEGIN
  IF (SELECT bridge_enabled FROM public.bridge_devices
      WHERE id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee') IS DISTINCT FROM false
     OR NOT EXISTS(SELECT 1 FROM public.bridge_grants
       WHERE device_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
         AND revoked_at IS NOT NULL) THEN
    RAISE EXCEPTION 'revoking PC did not stop its Bridge grant';
  END IF;
END $check$;
ROLLBACK;
