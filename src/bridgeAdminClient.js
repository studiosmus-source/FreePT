/**
 * Browser-side Bridge admin client. Never holds service-role keys or TX secrets.
 * Disabled by default. Requires an explicit HTTPS staging API endpoint and a
 * valid current Supabase user session on each request.
 *
 * Backend hosting/TLS is NOT supplied by this client.
 */
import {validateBridgeFolderPage,validateBridgeReadRequest,validateBridgeFileChunk} from './bridgeFileProtocol.js';
import {bridgePollRetry} from './bridgePollRetry.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATES=new Set(['queued','sent','done','cancelled','expired']);
const PROD='cpopqsvzzxfjgnlawlvc.supabase.co';
// The HTTPS gateway rejects 429 BEFORE dispatching any operation. Only such
// explicit throttling is replayable; network errors and 5xx are ambiguous.
const httpFailure=async response=>{
  const status=response?.status;
  if(status===401||status===403)return 'bridge_auth_required';
  if(status===429)return 'bridge_request_throttled';
  if([500,502,503,504].includes(status))return 'bridge_backend_unavailable';
  // The gateway returns stable error codes, not paths or file names.
  // Whitelist only known errors. Never expose arbitrary backend response text.
  if(status===409||status===404||status===400){
    let error=null;
    try{error=(await response.json())?.error}catch{/* no structured error */}
    if(status===409&&error==='device_unavailable')
      return 'bridge_device_unavailable';
    if(status===409&&error==='job_already_final')
      return 'bridge_job_already_final';
    if(status===404&&error==='not_found')
      return 'bridge_resource_not_found';
    if(status===400)return 'bridge_invalid_remote_request';
    return 'bridge_request_rejected_'+status;
  }
  return 'bridge_request_failed';
};
const defaultRetryPause=(ms,signal)=>new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(Error('bridge_transfer_cancelled'));return;}
  let timer;
  const aborted=()=>{
    clearTimeout(timer);
    signal?.removeEventListener('abort',aborted);
    reject(Error('bridge_transfer_cancelled'));
  };
  timer=setTimeout(()=>{
    signal?.removeEventListener('abort',aborted);
    resolve();
  },ms);
  signal?.addEventListener('abort',aborted,{once:true});
});

export function normalizeBridgeApiUrl(raw) {
  if (typeof raw!=='string' || !raw) return null;
  let url;
  try {url=new URL(raw);}catch{return null;}
  if(url.protocol!=='https:'||url.hostname===PROD||!url.hostname||
     url.username||url.password||url.search||url.hash||
     url.pathname!=='/'||url.port) return null;
  return url.origin;
}

export function createBridgeAdminClient({
  baseUrl,auth,fetchImpl=fetch,retryPause=defaultRetryPause,wakeJob=null
}={}) {
  const url=normalizeBridgeApiUrl(baseUrl);
  if(!url||typeof auth?.getSession!=='function'||typeof fetchImpl!=='function'||
     typeof retryPause!=='function')return null;
  // Coalesce FCM wake attempts; the already-running TX polls queued jobs itself.
  // A wake failure must never discard the queued, authorized server job.
  const lastWakeByDevice=new Map();
  const notifyWake=job=>{
    if(typeof wakeJob!=='function'||!UUID.test(job?.jobId)||!UUID.test(job?.deviceId))return;
    const now=Date.now(),previous=lastWakeByDevice.get(job.deviceId)||0;
    if(now-previous<12000)return;
    lastWakeByDevice.set(job.deviceId,now);
    void Promise.resolve().then(()=>wakeJob({jobId:job.jobId,deviceId:job.deviceId})).catch(()=>{});
  };
  const requestWithThrottleRetry=(endpoint,options)=>bridgePollRetry(
    ()=>fetchImpl(endpoint,options),{
      maxAttempts:3,
      pause:ms=>retryPause(ms,options.signal)
    });
  const perform=async(action,id,{signal}={})=>{
    if(!UUID.test(id))throw Error('bridge_invalid_id');
    const {data,error}=await auth.getSession();
    const token=data?.session?.access_token;
    if(error||typeof token!=='string'||token.length<20)
      throw Error('bridge_auth_required');
    if(signal?.aborted)throw Error('bridge_transfer_cancelled');
    const field=action==='list'?'deviceId':'jobId';
    let response;
    try {
      response=await requestWithThrottleRetry(url+'/bridge/admin/'+action,{
        method:'POST',
        headers:{'content-type':'application/json',authorization:'Bearer '+token},
        body:JSON.stringify({[field]:id}),
        cache:'no-store',
        redirect:'error',signal
      });
    }catch{
      if(signal?.aborted)throw Error('bridge_transfer_cancelled');
      throw Error('bridge_network_unavailable');
    }
    if(!response||!response.ok)throw Error(await httpFailure(response));
    let body;
    try{body=await response.json()}catch{throw Error('bridge_invalid_response');}
    if(!body||!UUID.test(body.jobId)||!UUID.test(body.deviceId)||
       !STATES.has(body.state)||
       (action==='list'&&body.deviceId!==id)||
       (action!=='list'&&body.jobId!==id)||
       (action==='cancel'&&body.state!=='cancelled'))
      throw Error('bridge_invalid_response');
    const job={jobId:body.jobId,deviceId:body.deviceId,state:body.state};
    if(action==='list'&&job.state==='queued')notifyWake(job);
    return job;
  };
  const getFolderPage=async jobId=>{
    if(!UUID.test(jobId))throw Error('bridge_invalid_id');
    const {data,error}=await auth.getSession();
    const token=data?.session?.access_token;
    if(error||typeof token!=='string'||token.length<20)
      throw Error('bridge_auth_required');
    let response;
    try{
      response=await requestWithThrottleRetry(url+'/bridge/admin/folder',{
        method:'POST',
        headers:{'content-type':'application/json',authorization:'Bearer '+token},
        body:JSON.stringify({jobId}),
        cache:'no-store',redirect:'error'
      });
    }catch{throw Error('bridge_network_unavailable');}
    if(!response||!response.ok)throw Error(await httpFailure(response));
    let payload;
    try{payload=await response.json()}catch{throw Error('bridge_invalid_response');}
    if(!payload||Object.keys(payload).sort().join(',')!=='entries,jobId,nextOffset'||
       payload.jobId!==jobId)
      throw Error('bridge_invalid_response');
    try{
      const page=validateBridgeFolderPage({
        entries:payload.entries,nextOffset:payload.nextOffset
      });
      return {jobId,entries:page.entries,nextOffset:page.nextOffset};
    }catch{throw Error('bridge_invalid_response');}
  };
  const readCall=async(action,body,{signal}={})=>{
    const {data,error}=await auth.getSession();
    const token=data?.session?.access_token;
    if(error||typeof token!=='string'||token.length<20)
      throw Error('bridge_auth_required');
    if(signal?.aborted)throw Error('bridge_transfer_cancelled');
    let response;
    try{
      response=await requestWithThrottleRetry(url+'/bridge/admin/'+action,{
        method:'POST',headers:{'content-type':'application/json',
          authorization:'Bearer '+token},
        body:JSON.stringify(body),cache:'no-store',redirect:'error',signal
      });
    }catch{
      if(signal?.aborted)throw Error('bridge_transfer_cancelled');
      throw Error('bridge_network_unavailable');
    }
    if(!response?.ok)throw Error(await httpFailure(response));
    try{return await response.json()}
    catch{throw Error('bridge_invalid_response');}
  };
  const requestBrowse=async(deviceId,{handle='root',offset=0}={},{signal}={})=>{
    if(!UUID.test(deviceId)||!(handle==='root'||UUID.test(handle))||
       !Number.isSafeInteger(offset)||offset<0||offset>10000)
      throw Error('bridge_browse_invalid');
    const result=await readCall('browse',{deviceId,handle,offset},{signal});
    if(!result||!UUID.test(result.jobId)||result.deviceId!==deviceId||
       result.state!=='queued')throw Error('bridge_invalid_response');
    notifyWake(result);
    return result;
  };
  const getBrowsePage=async(jobId,{signal}={})=>{
    if(!UUID.test(jobId))throw Error('bridge_invalid_id');
    const data=await readCall('browse-page',{jobId},{signal});
    if(data?.jobId!==jobId)throw Error('bridge_invalid_response');
    const page=validateBridgeFolderPage({entries:data.entries,nextOffset:data.nextOffset});
    return {jobId,entries:page.entries,nextOffset:page.nextOffset};
  };
  const requestRead=async(deviceId,request)=>{
    if(!UUID.test(deviceId))throw Error('bridge_invalid_id');
    const valid=validateBridgeReadRequest(request);
    if(valid.length>262144)throw Error("bridge_read_chunk_limit");
    const result=await readCall('read',{deviceId,...valid});
    if(!result||!UUID.test(result.jobId)||result.deviceId!==deviceId||
       result.state!=='queued'||Object.keys(result).sort().join(',')!=='deviceId,jobId,state')
      throw Error('bridge_invalid_response');
    notifyWake(result);
    return result;
  };
  const getReadChunk=async(jobId)=>{
    if(!UUID.test(jobId))throw Error('bridge_invalid_id');
    const result=await readCall('chunk',{jobId});
    try{
      if(!Number.isSafeInteger(result?.bytesRead)||result.bytesRead<1||
         result.bytesRead>262144)throw Error("invalid");
      return validateBridgeFileChunk(result,result.bytesRead);
    }catch{throw Error('bridge_invalid_response');}
  };
  return Object.freeze({
    requestRead,getReadChunk,requestBrowse,getBrowsePage,
    getFolderPage,
    requestList: deviceId=>perform('list',deviceId),
    getStatus: (jobId,options)=>perform('status',jobId,options),
    cancel: jobId=>perform('cancel',jobId)
  });
}
