-- FreePT TEST only: independently generated, bounded JPEG thumbnails.
-- Applies after 20261108_bridge_browse_staging.sql and session fencing.
-- Existing file READ/download jobs, grants and archived data are unchanged.
ALTER TABLE public.bridge_jobs DROP CONSTRAINT bridge_jobs_operation_check;
ALTER TABLE public.bridge_jobs ADD CONSTRAINT bridge_jobs_operation_check
  CHECK(operation IN ('list','read','browse','thumbnail'));

CREATE TABLE public.bridge_thumbnail_requests(
 job_id uuid PRIMARY KEY REFERENCES public.bridge_jobs(id) ON DELETE CASCADE,
 handle uuid NOT NULL
);
CREATE TABLE public.bridge_thumbnail_results(
 job_id uuid PRIMARY KEY REFERENCES public.bridge_jobs(id) ON DELETE CASCADE,
 chunk jsonb NOT NULL
);
ALTER TABLE public.bridge_thumbnail_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bridge_thumbnail_results ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bridge_thumbnail_requests,public.bridge_thumbnail_results
 FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.bridge_server_enqueue_thumbnail(
 p_job_id uuid,p_device_id uuid,p_receiver_id uuid,p_handle uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
BEGIN
 IF p_job_id IS NULL OR p_device_id IS NULL OR p_receiver_id IS NULL OR p_handle IS NULL
 THEN RAISE EXCEPTION 'bridge_thumbnail_invalid' USING errcode='22023'; END IF;
 PERFORM 1 FROM public.bridge_devices d
   WHERE d.id=p_device_id AND d.bridge_enabled=true FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'bridge_thumbnail_denied' USING errcode='42501'; END IF;
 IF NOT EXISTS(
   SELECT 1 FROM public.bridge_grants g JOIN public.profiles p ON p.id=g.receiver_id
   WHERE g.device_id=p_device_id AND g.receiver_id=p_receiver_id AND
     g.revoked_at IS NULL AND p.role='admin' AND p.status='approved'
 ) THEN RAISE EXCEPTION 'bridge_thumbnail_denied' USING errcode='42501'; END IF;
 -- Only opaque file handles from this receiver's recent authenticated listing.
 IF NOT EXISTS(
   SELECT 1 FROM public.bridge_folder_pages f
   JOIN public.bridge_jobs j ON j.id=f.job_id
   CROSS JOIN LATERAL jsonb_array_elements(f.entries) e(entry)
   WHERE j.device_id=p_device_id AND j.receiver_id=p_receiver_id
     AND j.operation IN ('list','browse') AND j.state='done'
     AND j.expires_at>clock_timestamp()
     AND e.entry->>'handle'=p_handle::text
     AND e.entry->>'directory'='false'
 ) THEN RAISE EXCEPTION 'bridge_thumbnail_handle_denied' USING errcode='42501'; END IF;
 INSERT INTO public.bridge_jobs(id,device_id,receiver_id,operation,state,expires_at)
 VALUES(p_job_id,p_device_id,p_receiver_id,'thumbnail','queued',
        clock_timestamp()+interval '60 seconds');
 INSERT INTO public.bridge_thumbnail_requests(job_id,handle) VALUES(p_job_id,p_handle);
 RETURN p_job_id;
END;
$$;

CREATE FUNCTION public.bridge_server_claim_thumbnail(
 p_device_id uuid,p_session_binding_hex text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE v_id uuid;v_request public.bridge_thumbnail_requests%rowtype;
BEGIN
 IF p_device_id IS NULL OR p_session_binding_hex !~ '^[0-9a-f]{64}$' THEN
   RAISE EXCEPTION 'bridge_thumbnail_invalid' USING errcode='22023'; END IF;
 PERFORM 1 FROM public.bridge_devices d
   WHERE d.id=p_device_id AND d.bridge_enabled=true FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'bridge_thumbnail_denied' USING errcode='42501'; END IF;
 PERFORM public.bridge_server_assert_tx_session(p_device_id,p_session_binding_hex);
 SELECT j.id INTO v_id FROM public.bridge_jobs j
   JOIN public.bridge_grants g ON g.device_id=j.device_id AND g.receiver_id=j.receiver_id
   JOIN public.profiles p ON p.id=j.receiver_id
   WHERE j.device_id=p_device_id AND j.operation='thumbnail'
     AND j.state='queued' AND j.expires_at>clock_timestamp()
     AND g.revoked_at IS NULL AND p.role='admin' AND p.status='approved'
   ORDER BY j.created_at,j.id LIMIT 1 FOR UPDATE OF j;
 IF v_id IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO STRICT v_request FROM public.bridge_thumbnail_requests WHERE job_id=v_id;
 UPDATE public.bridge_jobs SET state='sent',
   session_binding_hex=p_session_binding_hex,updated_at=clock_timestamp() WHERE id=v_id;
 RETURN jsonb_build_object('jobId',v_id,'deviceId',p_device_id,
    'operation','thumbnail','state','sent','handle',v_request.handle);
END;
$$;

CREATE FUNCTION public.bridge_server_complete_thumbnail(
 p_job_id uuid,p_device_id uuid,p_session_binding_hex text,p_chunk jsonb
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE v_job public.bridge_jobs%rowtype;
        v_encoded text;v_count integer;v_bytes bytea;
BEGIN
 IF p_job_id IS NULL OR p_device_id IS NULL OR p_session_binding_hex !~ '^[0-9a-f]{64}$'
    OR p_chunk IS NULL OR jsonb_typeof(p_chunk)<>'object'
    OR (SELECT count(*) FROM jsonb_object_keys(p_chunk))<>3
    OR NOT(p_chunk ?& array['base64','bytesRead','eof'])
    OR jsonb_typeof(p_chunk->'base64')<>'string'
    OR jsonb_typeof(p_chunk->'bytesRead')<>'number'
    OR p_chunk->'eof'<>'true'::jsonb
 THEN RAISE EXCEPTION 'bridge_thumbnail_invalid' USING errcode='22023'; END IF;
 v_encoded:=p_chunk->>'base64';
 IF length(v_encoded)>43692
    OR v_encoded !~ '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$'
    OR (p_chunk->>'bytesRead') !~ '^[0-9]+$'
 THEN RAISE EXCEPTION 'bridge_thumbnail_invalid' USING errcode='22023'; END IF;
 BEGIN
    v_count:=(p_chunk->>'bytesRead')::integer;
    v_bytes:=decode(v_encoded,'base64');
    IF v_count<4 OR v_count>32768 OR octet_length(v_bytes)<>v_count
       OR encode(v_bytes,'base64')<>v_encoded
       OR get_byte(v_bytes,0)<>255 OR get_byte(v_bytes,1)<>216
       OR get_byte(v_bytes,v_count-2)<>255 OR get_byte(v_bytes,v_count-1)<>217
    THEN RAISE EXCEPTION 'bridge_thumbnail_invalid' USING errcode='22023'; END IF;
 EXCEPTION WHEN numeric_value_out_of_range OR invalid_text_representation THEN
    RAISE EXCEPTION 'bridge_thumbnail_invalid' USING errcode='22023';
 END;
 PERFORM 1 FROM public.bridge_devices d
    WHERE d.id=p_device_id AND d.bridge_enabled=true FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'bridge_thumbnail_denied' USING errcode='42501'; END IF;
 PERFORM public.bridge_server_assert_tx_session(p_device_id,p_session_binding_hex);
 SELECT * INTO v_job FROM public.bridge_jobs j
    WHERE j.id=p_job_id AND j.device_id=p_device_id FOR UPDATE;
 IF NOT FOUND OR v_job.operation<>'thumbnail' OR v_job.state<>'sent'
    OR v_job.expires_at<=clock_timestamp()
    OR v_job.session_binding_hex IS DISTINCT FROM p_session_binding_hex
    OR NOT EXISTS(
      SELECT 1 FROM public.bridge_grants g JOIN public.profiles p ON p.id=g.receiver_id
      WHERE g.device_id=p_device_id AND g.receiver_id=v_job.receiver_id
        AND g.revoked_at IS NULL AND p.role='admin' AND p.status='approved'
    )
 THEN RAISE EXCEPTION 'bridge_thumbnail_denied' USING errcode='42501'; END IF;
 INSERT INTO public.bridge_thumbnail_results(job_id,chunk) VALUES(p_job_id,p_chunk);
 UPDATE public.bridge_jobs SET state='done',updated_at=clock_timestamp(),
   expires_at=clock_timestamp()+interval '5 minutes' WHERE id=p_job_id;
 RETURN true;
END;
$$;

CREATE FUNCTION public.bridge_server_read_thumbnail(
 p_job_id uuid,p_receiver_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE v_job public.bridge_jobs%rowtype;v_chunk jsonb;
BEGIN
 IF p_job_id IS NULL OR p_receiver_id IS NULL THEN
    RAISE EXCEPTION 'bridge_thumbnail_invalid' USING errcode='22023'; END IF;
 SELECT * INTO v_job FROM public.bridge_jobs j
    WHERE j.id=p_job_id AND j.receiver_id=p_receiver_id;
 IF NOT FOUND OR v_job.operation<>'thumbnail' OR v_job.state<>'done'
    OR v_job.expires_at<=clock_timestamp()
    OR NOT EXISTS(SELECT 1 FROM public.bridge_devices d
      WHERE d.id=v_job.device_id AND d.bridge_enabled=true)
    OR NOT EXISTS(
      SELECT 1 FROM public.bridge_grants g JOIN public.profiles p ON p.id=g.receiver_id
      WHERE g.device_id=v_job.device_id AND g.receiver_id=p_receiver_id
        AND g.revoked_at IS NULL AND p.role='admin' AND p.status='approved'
    )
 THEN RAISE EXCEPTION 'bridge_thumbnail_denied' USING errcode='42501'; END IF;
 SELECT t.chunk INTO v_chunk FROM public.bridge_thumbnail_results t WHERE t.job_id=p_job_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'bridge_thumbnail_denied' USING errcode='42501'; END IF;
 RETURN v_chunk;
END;
$$;

REVOKE ALL ON FUNCTION public.bridge_server_enqueue_thumbnail(uuid,uuid,uuid,uuid)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.bridge_server_claim_thumbnail(uuid,text)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.bridge_server_complete_thumbnail(uuid,uuid,text,jsonb)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.bridge_server_read_thumbnail(uuid,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bridge_server_enqueue_thumbnail(uuid,uuid,uuid,uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.bridge_server_claim_thumbnail(uuid,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.bridge_server_complete_thumbnail(uuid,uuid,text,jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.bridge_server_read_thumbnail(uuid,uuid)
  TO service_role;
