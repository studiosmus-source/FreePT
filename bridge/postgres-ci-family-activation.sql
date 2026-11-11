-- Run only on disposable CI PostgreSQL after owner controls and family migration.
BEGIN;
INSERT INTO public.bridge_devices(id,owner_id,label)
VALUES('c4f79dc2-1d5e-42fd-87a2-c5a8e628f3a4',
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Family phone');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
DO $t$ BEGIN
  IF public.bridge_owner_activate_family('c4f79dc2-1d5e-42fd-87a2-c5a8e628f3a4')
     <> 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid THEN
    RAISE EXCEPTION 'unexpected receiver';
  END IF;
END $t$;
RESET ROLE;
DO $t$ BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM public.bridge_devices
    WHERE id='c4f79dc2-1d5e-42fd-87a2-c5a8e628f3a4' AND bridge_enabled=true
  ) OR NOT EXISTS(
    SELECT 1 FROM public.bridge_grants
    WHERE device_id='c4f79dc2-1d5e-42fd-87a2-c5a8e628f3a4'
      AND receiver_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
      AND revoked_at IS NULL
  ) THEN RAISE EXCEPTION 'not activated'; END IF;
END $t$;
-- A non-owner cannot activate the same device.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',false);
DO $t$ BEGIN
  BEGIN
    PERFORM public.bridge_owner_activate_family('c4f79dc2-1d5e-42fd-87a2-c5a8e628f3a4');
    RAISE EXCEPTION 'foreign activation succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $t$;
RESET ROLE;
-- No ambiguous authorization if there are two approved administrators.
INSERT INTO public.profiles(id,role,status) VALUES
 ('c83f5929-aefe-4f35-a77d-b3e8d22adf7a','admin','approved');
INSERT INTO public.bridge_devices(id,owner_id,label)
VALUES('a0198932-d40c-4a81-88e3-8d53fbd2dba6',
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Second family phone');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
DO $t$ BEGIN
  BEGIN
    PERFORM public.bridge_owner_activate_family('a0198932-d40c-4a81-88e3-8d53fbd2dba6');
    RAISE EXCEPTION 'ambiguous activation succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $t$;
RESET ROLE;
DO $t$ BEGIN
  IF EXISTS(SELECT 1 FROM public.bridge_grants WHERE device_id='a0198932-d40c-4a81-88e3-8d53fbd2dba6')
     OR EXISTS(SELECT 1 FROM public.bridge_devices
       WHERE id='a0198932-d40c-4a81-88e3-8d53fbd2dba6' AND bridge_enabled=true)
  THEN RAISE EXCEPTION 'ambiguous activation leaked permission'; END IF;
END $t$;
ROLLBACK;
