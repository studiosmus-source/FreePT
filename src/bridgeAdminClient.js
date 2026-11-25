/**
 * Browser-side Bridge admin client. Never holds service-role keys or TX secrets.
 * Disabled by default. Requires an explicit HTTPS staging API endpoint and a
 * valid current Supabase user session on each request.
 *
 * Backend hosting/TLS is NOT supplied by this client.
 */
import {validateBridgeFolderPage,validateBridgeReadRequest,validateBridgeFileChunk} from './bridgeFileProtocol.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATES=new Set(['queued','sent','done','cancelled','expired']);
const PROD='cpopqsvzzxfjgnlawlvc.supabase.co';

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
  baseUrl,auth,fetchImpl=fetch,wakeQueuedJob=null,requestTimeoutMs=20000
}={}) {
  const url=normalizeBridgeApiUrl(baseUrl);
  if(!url||typeof auth?.getSession!=='function'||typeof fetchImpl!=='function'||
     !Number.isSafeInteger(requestTimeoutMs)||requestTimeoutMs<1||requestTimeoutMs>120000)
    return null;
  // Best-effort wake only for authenticated, validated jobs. Never block a job on FCM.
  const wake=jobId=>{
    if(typeof wakeQueuedJob!=='function')return;
    try{Promise.resolve(wakeQueuedJob(jobId)).catch(()=>{});}catch{/* push unavailable; normal polling remains valid */}
  };
  const requestJson=async(action,body,token,signal)=>{
    if(signal?.aborted)throw Error('bridge_transfer_cancelled');
    const controller=new AbortController();
    const abort=()=>controller.abort();
    signal?.addEventListener('abort',abort,{once:true});
    let timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;controller.abort();},requestTimeoutMs);
    try{
      const response=await fetchImpl(url+'/bridge/admin/'+action,{
        method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},
        body:JSON.stringify(body),cache:'no-store',redirect:'error',signal:controller.signal
      });
      if(!response?.ok){
        if(response?.status===401||response?.status===403)throw Error('bridge_auth_required');
        if(response?.status===429)throw Error('bridge_request_throttled');
        if(response?.status>=500)throw Error('bridge_backend_unavailable');
        throw Error('bridge_request_failed');
      }
      try{return await response.json();}
      catch{
        if(signal?.aborted)throw Error('bridge_transfer_cancelled');
        if(timedOut)throw Error('bridge_http_timeout');
        throw Error('bridge_invalid_response');
      }
    }catch(error){
      if(signal?.aborted)throw Error('bridge_transfer_cancelled');
      if(timedOut)throw Error('bridge_http_timeout');
      if(typeof error?.message==='string'&&error.message.startsWith('bridge_'))throw error;
      throw Error('bridge_network_unavailable');
    }finally{
      clearTimeout(timer);signal?.removeEventListener('abort',abort);
    }
  };
  const perform=async(action,id,{signal}={})=>{
    if(!UUID.test(id))throw Error('bridge_invalid_id');
    const {data,error}=await auth.getSession();
    const token=data?.session?.access_token;
    if(error||typeof token!=='string'||token.length<20)
      throw Error('bridge_auth_required');
    if(signal?.aborted)throw Error('bridge_transfer_cancelled');
    const field=action==='list'?'deviceId':'jobId';
    const body=await requestJson(action,{[field]:id},token,signal);
    if(!body||!UUID.test(body.jobId)||!UUID.test(body.deviceId)||
       !STATES.has(body.state)||
       (action==='list'&&body.deviceId!==id)||
       (action!=='list'&&body.jobId!==id)||
       (action==='cancel'&&body.state!=='cancelled'))
      throw Error('bridge_invalid_response');
    if(action==='list'&&body.state==='queued')wake(body.jobId);
    return {jobId:body.jobId,deviceId:body.deviceId,state:body.state};
  };
  const getFolderPage=async jobId=>{
    if(!UUID.test(jobId))throw Error('bridge_invalid_id');
    const {data,error}=await auth.getSession();
    const token=data?.session?.access_token;
    if(error||typeof token!=='string'||token.length<20)
      throw Error('bridge_auth_required');
    const payload=await requestJson('folder',{jobId},token);
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
    return requestJson(action,body,token,signal);
  };
  const requestBrowse=async(deviceId,{handle='root',offset=0}={},{signal}={})=>{
    if(!UUID.test(deviceId)||!(handle==='root'||UUID.test(handle))||
       !Number.isSafeInteger(offset)||offset<0||offset>10000)
      throw Error('bridge_browse_invalid');
    const result=await readCall('browse',{deviceId,handle,offset},{signal});
    if(!result||!UUID.test(result.jobId)||result.deviceId!==deviceId||
       result.state!=='queued')throw Error('bridge_invalid_response');
    if(!signal?.aborted)wake(result.jobId);
    return result;
  };
  const getBrowsePage=async(jobId,{signal}={})=>{
    if(!UUID.test(jobId))throw Error('bridge_invalid_id');
    const data=await readCall('browse-page',{jobId},{signal});
    if(data?.jobId!==jobId)throw Error('bridge_invalid_response');
    const page=validateBridgeFolderPage({entries:data.entries,nextOffset:data.nextOffset});
    return {jobId,entries:page.entries,nextOffset:page.nextOffset};
  };
  const requestRead=async(deviceId,request,{signal}={})=>{
    if(!UUID.test(deviceId))throw Error('bridge_invalid_id');
    const valid=validateBridgeReadRequest(request);
    if(valid.length>262144)throw Error("bridge_read_chunk_limit");
    const result=await readCall('read',{deviceId,...valid},{signal});
    if(!result||!UUID.test(result.jobId)||result.deviceId!==deviceId||
       result.state!=='queued'||Object.keys(result).sort().join(',')!=='deviceId,jobId,state')
      throw Error('bridge_invalid_response');
    wake(result.jobId);
    return result;
  };
  const getReadChunk=async(jobId,{signal}={})=>{
    if(!UUID.test(jobId))throw Error('bridge_invalid_id');
    const result=await readCall('chunk',{jobId},{signal});
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
