-- FreePT Bridge – Fase 4: blocchi di trasferimento fino a 256 KiB  (PROPOSTA, NON applicata alla produzione)
--
-- Oggi il download usa un job di lettura per ogni blocco da 32 KiB, con una
-- attesa di polling per ciascuno: ~1-2 minuti per una foto da 2 MB. Il contratto
-- JS consente già 262144 byte (BRIDGE_FILE_LIMITS.maxChunkBytes); mancano
-- l'allineamento del nativo/gateway (fatto nel ramo) e questi due limiti SQL.
--
-- Qui si alzano SOLO due soglie numeriche; ogni altro controllo (SHA/base64,
-- conteggio byte, grant, sessione, job, anti-troncamento, firma) resta identico.
-- La scrittura su file lato RX resta a 32 KiB (disaccoppiata nel client),
-- quindi il plugin SAF nativo non cambia.
--
-- base64(262144 byte) = 349528 caratteri.
-- Idempotente (CREATE OR REPLACE). Non modifica dati. Da applicare INSIEME alla
-- nuova APK e al deploy del gateway: una sola delle due parti non basta.

CREATE OR REPLACE FUNCTION public.bridge_server_enqueue_read(p_job_id uuid, p_device_id uuid, p_receiver_id uuid, p_handle uuid, p_offset bigint, p_length integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if p_job_id is null or p_device_id is null or p_receiver_id is null or
     p_handle is null or p_offset is null or p_offset<0 or
     p_length is null or p_length not between 1 and 262144 then
    raise exception 'bridge_read_invalid' using errcode='22023';
  end if;
  perform 1 from public.bridge_devices d where d.id=p_device_id
    and d.bridge_enabled=true for update;
  if not found then raise exception 'bridge_read_denied' using errcode='42501'; end if;
  if not exists (
    select 1 from public.bridge_grants g
    join public.profiles p on p.id=g.receiver_id
    where g.device_id=p_device_id and g.receiver_id=p_receiver_id
      and g.revoked_at is null and p.role='admin' and p.status='approved'
  ) then raise exception 'bridge_read_denied' using errcode='42501'; end if;
  if not exists (
    select 1 from public.bridge_folder_pages f
    join public.bridge_jobs j on j.id=f.job_id
    cross join lateral jsonb_array_elements(f.entries) as e(entry)
    where j.device_id=p_device_id and j.receiver_id=p_receiver_id
      and j.operation in ('list','browse') and j.state='done'
      and j.expires_at>clock_timestamp()
      and e.entry->>'handle'=p_handle::text
      and e.entry->>'directory'='false'
      and (e.entry->>'size')::bigint>=p_offset+p_length
  ) then raise exception 'bridge_read_handle_denied' using errcode='42501'; end if;
  insert into public.bridge_jobs(id,device_id,receiver_id,operation,state,expires_at)
    values(p_job_id,p_device_id,p_receiver_id,'read','queued',
      clock_timestamp()+interval '60 seconds');
  insert into public.bridge_read_requests(job_id,handle,byte_offset,byte_length)
    values(p_job_id,p_handle,p_offset,p_length);
  return p_job_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.bridge_server_complete_read(p_job_id uuid, p_device_id uuid, p_session_binding_hex text, p_chunk jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_job public.bridge_jobs%rowtype;
        v_request public.bridge_read_requests%rowtype;
        v_data text; v_count integer;
begin
  if p_job_id is null or p_device_id is null or
     p_session_binding_hex is null or p_session_binding_hex !~ '^[0-9a-f]{64}$' or
     p_chunk is null or jsonb_typeof(p_chunk)<>'object' or
     (select count(*) from jsonb_object_keys(p_chunk))<>3 or
     not(p_chunk ?& array['base64','bytesRead','eof']) or
     jsonb_typeof(p_chunk->'base64')<>'string' or
     jsonb_typeof(p_chunk->'bytesRead')<>'number' or
     jsonb_typeof(p_chunk->'eof')<>'boolean' then
    raise exception 'bridge_chunk_invalid' using errcode='22023';
  end if;
  v_data:=p_chunk->>'base64';
  if v_data !~ '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$'
     or length(v_data)>349528 or
     (p_chunk->>'bytesRead') !~ '^[0-9]+$' then
    raise exception 'bridge_chunk_invalid' using errcode='22023';
  end if;
  begin
    v_count:=(p_chunk->>'bytesRead')::integer;
    -- encode() in PostgreSQL inserts a newline every 76 chars; the TX sends
    -- base64 without newlines. Strip newlines before comparing.
    if octet_length(decode(v_data,'base64'))<>v_count or
       translate(encode(decode(v_data,'base64'),'base64'), E'\n', '')<>v_data then
      raise exception 'bridge_chunk_invalid' using errcode='22023';
    end if;
  exception when numeric_value_out_of_range or invalid_text_representation then
    raise exception 'bridge_chunk_invalid' using errcode='22023';
  end;
  perform 1 from public.bridge_devices d where d.id=p_device_id
    and d.bridge_enabled=true for update;
  if not found then raise exception 'bridge_read_denied' using errcode='42501'; end if;
  perform public.bridge_server_assert_tx_session(p_device_id,p_session_binding_hex);
  select * into v_job from public.bridge_jobs j where j.id=p_job_id
    and j.device_id=p_device_id for update;
  if not found or v_job.operation<>'read' or v_job.state<>'sent' or
     v_job.expires_at<=clock_timestamp() or
     v_job.session_binding_hex is distinct from p_session_binding_hex then
    raise exception 'bridge_read_denied' using errcode='42501';
  end if;
  if not exists(select 1 from public.bridge_grants g
    join public.profiles p on p.id=g.receiver_id
    where g.device_id=p_device_id and g.receiver_id=v_job.receiver_id
      and g.revoked_at is null and p.role='admin' and p.status='approved')
  then raise exception 'bridge_read_denied' using errcode='42501'; end if;
  select * into strict v_request from public.bridge_read_requests where job_id=p_job_id;
  if v_count<>v_request.byte_length then
    raise exception 'bridge_chunk_truncated' using errcode='22023';
  end if;
  insert into public.bridge_read_results(job_id,chunk) values(p_job_id,p_chunk);
  update public.bridge_jobs set state='done',updated_at=clock_timestamp() where id=p_job_id;
  return true;
end;
$function$;
