/**
 * Opt-in, metadata-only staging diagnostics. Never serialize request/response
 * objects, headers, exception messages, paths, file names or credentials.
 * References are HMACs with a fresh, undisclosed process-local key.
 */
import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPERATIONS=new Set([
  'admin/list','admin/read','admin/browse','admin/browse-page',
  'admin/thumbnail','admin/thumbnail-result','admin/chunk','admin/status',
  'admin/cancel','admin/folder','owner/enroll','owner/delete',
  'tx/connect','tx/poll','tx/complete','tx/folder','tx/chunk','tx/browse',
  'tx/thumbnail','tx/disconnect',
  'bootstrap/start','bootstrap/poll','bootstrap/chunk','bootstrap/status',
  'bootstrap/claim','bootstrap/cancel','bootstrap/approve','bootstrap/revoke'
]);
const STATES=new Set(['queued','sent','done','cancelled','expired']);
const ERRORS=new Set([
  'origin_denied','https_required','not_found','method_not_allowed',
  'rate_limited','unsupported_media_type','payload_too_large',
  'invalid_request','invalid_json','response_too_large','bridge_unavailable',
  'authentication_required','admin_denied','bridge_admin_denied',
  'bridge_owner_denied','bridge_enrollment_unavailable','tx_denied',
  'tx_rate_limited','device_unavailable','job_already_final',
  'invalid_device_id','invalid_job_id','read_jobs_disabled'
]);

export function createBridgeRequestDiagnostics({
  sink=line=>console.log(line),now=()=>performance.now(),
  waitingMs=10000,maxEventsPerMinute=1200
}={}){
  if(typeof sink!=='function'||typeof now!=='function'||
     !Number.isSafeInteger(waitingMs)||waitingMs<1||
     !Number.isSafeInteger(maxEventsPerMinute)||maxEventsPerMinute<1)
    throw Error('bridge_diagnostics_dependencies_invalid');
  const key=randomBytes(32),instance=randomBytes(8).toString('hex');
  let windowStart=now(),count=0,dropped=0;
  const emit=record=>{
    try{
      const time=now();
      if(time-windowStart>=60000){
        if(dropped)sink(JSON.stringify({
          event:'bridge_request',version:1,instance,phase:'suppressed',count:dropped
        }));
        windowStart=time;count=0;dropped=0;
      }
      if(count>=maxEventsPerMinute){dropped++;return;}
      count++;
      sink(JSON.stringify({event:'bridge_request',version:1,instance,...record}));
    }catch{/* Logging failure must never affect an authorized operation. */}
  };
  const reference=(kind,value)=>typeof value==='string'&&UUID.test(value)
    ?createHmac('sha256',key).update(kind+'\0'+value.toLowerCase())
      .digest('hex').slice(0,24):undefined;
  return Object.freeze({
    begin(path){
      const operation=typeof path==='string'&&path.startsWith('/bridge/')
        ?path.slice('/bridge/'.length):'';
      if(!OPERATIONS.has(operation))return null;
      const request=randomUUID(),start=now();
      let ended=false,timer,device,job,state,error,hasJob;
      const snapshot=phase=>({
        request,operation,phase,elapsedMs:Math.max(0,Math.round(now()-start)),
        ...(device?{device}:{}),...(job?{job}:{}),
        ...(state?{state}:{}),...(error?{error}:{}),
        ...(hasJob===undefined?{}:{hasJob})
      });
      emit(snapshot('received'));
      const end=(phase,status)=>{
        if(ended)return;
        ended=true;clearTimeout(timer);
        emit({...snapshot(phase),...(Number.isInteger(status)?{status}:{})});
      };
      return Object.freeze({
        dispatch(body){
          if(ended)return;
          device=reference('device',body?.deviceId);
          job=reference('job',body?.jobId);
          emit(snapshot('dispatched'));
          timer=setTimeout(()=>{if(!ended)emit(snapshot('handler_waiting'));},waitingMs);
          timer.unref?.();
        },
        result(status,body){
          if(ended)return;
          clearTimeout(timer);
          device=reference('device',body?.deviceId)||device;
          job=reference('job',body?.jobId)||
            reference('job',body?.job?.jobId)||job;
          state=STATES.has(body?.state)?body.state:undefined;
          error=typeof body?.error==='string'
            ?(ERRORS.has(body.error)?body.error:'unclassified_error'):undefined;
          if(operation==='tx/poll'&&status===200)
            hasJob=body?.job!==null&&body?.job!==undefined;
          emit({...snapshot('result'),status});
        },
        finish:status=>end('finished',status),
        abort:()=>end('aborted')
      });
    }
  });
}

export function stagingBridgeDiagnostics(env={},options){
  const setting=env.FREEPT_BRIDGE_DIAGNOSTICS;
  if(setting===undefined||setting==='')return null;
  if(setting!=='STAGING_METADATA_V1')throw Error('bridge_diagnostics_opt_in_invalid');
  return createBridgeRequestDiagnostics(options);
}
