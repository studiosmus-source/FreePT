/**
 * Browser-side Bridge admin client. Never holds service-role keys or TX secrets.
 * Disabled by default. Requires an explicit HTTPS staging API endpoint and a
 * valid current Supabase user session on each request.
 *
 * Backend hosting/TLS is NOT supplied by this client.
 */
import {validateBridgeFolderPage,validateBridgeReadRequest,validateBridgeFileChunk} from './bridgeFileProtocol.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATES=new Set(['queued','sent','done','cancelled']);
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

export function createBridgeAdminClient({baseUrl,auth,fetchImpl=fetch}={}) {
  const url=normalizeBridgeApiUrl(baseUrl);
  if(!url||typeof auth?.getSession!=='function'||typeof fetchImpl!=='function')
    return null;
  const perform=async(action,id)=>{
    if(!UUID.test(id))throw Error('bridge_invalid_id');
    const {data,error}=await auth.getSession();
    const token=data?.session?.access_token;
    if(error||typeof token!=='string'||token.length<20)
      throw Error('bridge_auth_required');
    const field=action==='list'?'deviceId':'jobId';
    let response;
    try {
      response=await fetchImpl(url+'/bridge/admin/'+action,{
        method:'POST',
        headers:{'content-type':'application/json',authorization:'Bearer '+token},
        body:JSON.stringify({[field]:id}),
        cache:'no-store',
        redirect:'error'
      });
    }catch{throw Error('bridge_network_unavailable');}
    if(!response||!response.ok)
      throw Error(response?.status===401||response?.status===403
        ?'bridge_auth_required':'bridge_request_failed');
    let body;
    try{body=await response.json()}catch{throw Error('bridge_invalid_response');}
    if(!body||!UUID.test(body.jobId)||!UUID.test(body.deviceId)||
       !STATES.has(body.state)||
       (action==='list'&&body.deviceId!==id)||
       (action!=='list'&&body.jobId!==id)||
       (action==='cancel'&&body.state!=='cancelled'))
      throw Error('bridge_invalid_response');
    return {jobId:body.jobId,deviceId:body.deviceId,state:body.state};
  };
  const getFolderPage=async jobId=>{
    if(!UUID.test(jobId))throw Error('bridge_invalid_id');
    const {data,error}=await auth.getSession();
    const token=data?.session?.access_token;
    if(error||typeof token!=='string'||token.length<20)
      throw Error('bridge_auth_required');
    let response;
    try{
      response=await fetchImpl(url+'/bridge/admin/folder',{
        method:'POST',
        headers:{'content-type':'application/json',authorization:'Bearer '+token},
        body:JSON.stringify({jobId}),
        cache:'no-store',redirect:'error'
      });
    }catch{throw Error('bridge_network_unavailable');}
    if(!response||!response.ok)
      throw Error(response?.status===401||response?.status===403
        ?'bridge_auth_required':'bridge_request_failed');
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
  const readCall=async(action,body)=>{
    const {data,error}=await auth.getSession();
    const token=data?.session?.access_token;
    if(error||typeof token!=='string'||token.length<20)
      throw Error('bridge_auth_required');
    let response;
    try{
      response=await fetchImpl(url+'/bridge/admin/'+action,{
        method:'POST',headers:{'content-type':'application/json',
          authorization:'Bearer '+token},
        body:JSON.stringify(body),cache:'no-store',redirect:'error'
      });
    }catch{throw Error('bridge_network_unavailable');}
    if(!response?.ok)
      throw Error(response?.status===401||response?.status===403?
        'bridge_auth_required':'bridge_request_failed');
    try{return await response.json()}
    catch{throw Error('bridge_invalid_response');}
  };
  const requestRead=async(deviceId,request)=>{
    if(!UUID.test(deviceId))throw Error('bridge_invalid_id');
    const valid=validateBridgeReadRequest(request);
    if(valid.length>32768)throw Error('bridge_read_chunk_limit');
    const result=await readCall('read',{deviceId,...valid});
    if(!result||!UUID.test(result.jobId)||result.deviceId!==deviceId||
       result.state!=='queued'||Object.keys(result).sort().join(',')!=='deviceId,jobId,state')
      throw Error('bridge_invalid_response');
    return result;
  };
  const getReadChunk=async(jobId)=>{
    if(!UUID.test(jobId))throw Error('bridge_invalid_id');
    const result=await readCall('chunk',{jobId});
    try{
      if(!Number.isSafeInteger(result?.bytesRead)||result.bytesRead<1||
         result.bytesRead>32768)throw Error('invalid');
      return validateBridgeFileChunk(result,result.bytesRead);
    }catch{throw Error('bridge_invalid_response');}
  };
  return Object.freeze({
    requestRead,getReadChunk,
    getFolderPage,
    requestList: deviceId=>perform('list',deviceId),
    getStatus: jobId=>perform('status',jobId),
    cancel: jobId=>perform('cancel',jobId)
  });
}
