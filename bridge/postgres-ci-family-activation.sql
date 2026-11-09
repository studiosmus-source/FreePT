-- Run only on disposable CI PostgreSQL after owner controls and family migration.
BEGIN;
INSERT INTO public.bridge_devices(id,owner_id,label)
VALUES('dddddddd-dddd-4ddd-8ddd-dddddddddddd',
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Family phone');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
DO $t$ BEGIN
  IF public.bridge_owner_activate_family('dddddddd-dddd-4ddd-8ddd-dddddddddddd')
     <> 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid THEN
    RAISE EXCEPTION 'unexpected receiver';
  END IF;
END $t$;
RESET ROLE;
DO $t$ BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM public.bridge_devices
    WHERE id='dddddddd-dddd-4ddd-8ddd-dddddddddddd' AND bridge_enabled=true
  ) OR NOT EXISTS(
    SELECT 1 FROM public.bridge_grants
    WHERE device_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
      AND receiver_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
      AND revoked_at IS NULL
  ) THEN RAISE EXCEPTION 'not activated'; END IF;
END $t$;
-- A non-owner cannot activate the same device.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',false);
DO $t$ BEGIN
  BEGIN
    PERFORM public.bridge_owner_activate_family('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
    RAISE EXCEPTION 'foreign activation succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $t$;
RESET ROLE;
-- No ambiguous authorization if there are two approved administrators.
INSERT INTO public.profiles(id,role,status) VALUES
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','admin','approved');
INSERT INTO public.bridge_devices(id,owner_id,label)
VALUES('ffffffff-ffff-4fff-8fff-ffffffffffff',
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Second family phone');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
DO $t$ BEGIN
  BEGIN
    PERFORM public.bridge_owner_activate_family('ffffffff-ffff-4fff-8fff-ffffffffffff');
    RAISE EXCEPTION 'ambiguous activation succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $t$;
RESET ROLE;
DO $t$ BEGIN
  IF EXISTS(SELECT 1 FROM public.bridge_grants WHERE device_id='ffffffff-ffff-4fff-8fff-ffffffffffff')
     OR EXISTS(SELECT 1 FROM public.bridge_devices
       WHERE id='ffffffff-ffff-4fff-8fff-ffffffffffff' AND bridge_enabled=true)
  THEN RAISE EXCEPTION 'ambiguous activation leaked permission'; END IF;
END $t$;
ROLLBACK;
