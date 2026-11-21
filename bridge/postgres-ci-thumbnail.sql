-- Synthetic PostgreSQL thumbnail-job integration. Disposable CI database only.
\set ON_ERROR_STOP on
DO $test$
DECLARE
  dev uuid:=gen_random_uuid();
  owner_id uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  admin_id uuid:='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  stranger uuid:='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  browse_job uuid:=gen_random_uuid();
  thumb_job uuid:=gen_random_uuid();
  file_handle uuid:=gen_random_uuid();
  binding text:=repeat('9',64);
  verifier text:=repeat('a',64);
  claimed jsonb;
  result jsonb;
  jpg jsonb:=jsonb_build_object('base64',encode(decode('ffd8ffd9','hex'),'base64'),'bytesRead',4,'eof',true);
BEGIN
  IF has_function_privilege('authenticated',
    'public.bridge_server_enqueue_thumbnail(uuid,uuid,uuid,uuid)','EXECUTE')
     OR has_table_privilege('authenticated','public.bridge_thumbnail_results','SELECT')
  THEN RAISE EXCEPTION 'thumbnail data leaked to authenticated role'; END IF;
  INSERT INTO public.bridge_devices(id,owner_id,label)
    VALUES(dev,owner_id,'Synthetic thumbnail fixture');
  PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
  PERFORM public.bridge_owner_grant(dev,admin_id);
  PERFORM public.bridge_owner_set_enabled(dev,true);
  INSERT INTO public.bridge_device_verifiers(device_id,salt_hex,verifier_hex)
    VALUES(dev,repeat('b',32),verifier);
  PERFORM public.bridge_server_open_tx_session(dev,binding,verifier);
  PERFORM public.bridge_server_enqueue_browse(browse_job,dev,admin_id,'root',0);
  claimed:=public.bridge_server_claim_browse(dev,binding);
  IF claimed->>'jobId' IS DISTINCT FROM browse_job::text
  THEN RAISE EXCEPTION 'synthetic browse claim failed'; END IF;
  PERFORM public.bridge_server_complete_browse_page(browse_job,dev,binding,
    jsonb_build_array(jsonb_build_object(
      'handle',file_handle::text,'name','sample.jpg',
      'directory',false,'size',12345678,'mime','image/jpeg')),-1);
  BEGIN
    PERFORM public.bridge_server_enqueue_thumbnail(thumb_job,dev,stranger,file_handle);
    RAISE EXCEPTION 'stranger thumbnail request accepted';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
  PERFORM public.bridge_server_enqueue_thumbnail(thumb_job,dev,admin_id,file_handle);
  IF (SELECT operation FROM public.bridge_jobs WHERE id=thumb_job)<>'thumbnail'
  THEN RAISE EXCEPTION 'thumbnail enqueue missing'; END IF;
  claimed:=public.bridge_server_claim_thumbnail(dev,binding);
  IF claimed->>'jobId' IS DISTINCT FROM thumb_job::text OR
     claimed->>'handle' IS DISTINCT FROM file_handle::text
  THEN RAISE EXCEPTION 'thumbnail claim wrong'; END IF;
  IF NOT public.bridge_server_complete_thumbnail(thumb_job,dev,binding,jpg)
  THEN RAISE EXCEPTION 'thumbnail completion failed'; END IF;
  result:=public.bridge_server_read_thumbnail(thumb_job,admin_id);
  IF result IS DISTINCT FROM jpg
  THEN RAISE EXCEPTION 'thumbnail result mismatch'; END IF;
  PERFORM public.bridge_owner_revoke(dev,admin_id);
  BEGIN
    PERFORM public.bridge_server_read_thumbnail(thumb_job,admin_id);
    RAISE EXCEPTION 'revoked admin read thumbnail';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
END
$test$;
SELECT 'bridge-thumbnail-integration-ok' AS result;
