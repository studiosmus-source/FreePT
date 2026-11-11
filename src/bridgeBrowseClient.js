import {validateBridgeFolderPage} from './bridgeFileProtocol.js';

/**
 * Authenticated remote directory browsing: one paginated job per SAF page.
 * No document URI or local filesystem path crosses the API. Each server job
 * must be authorized against the owner's selected folder and current grant.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function createBridgeRemoteFolderLister({
  api,deviceId,pause=wait,pollMs=700,maxPolls=60
}={}){
  if(!UUID.test(deviceId)||!api||
     ['requestBrowse','getStatus','getBrowsePage'].some(k=>typeof api[k]!=='function')||
     typeof pause!=='function'||!Number.isSafeInteger(pollMs)||pollMs<0||
     !Number.isSafeInteger(maxPolls)||maxPolls<1)
    throw Error('bridge_remote_browse_invalid_options');

  return async function listPage({handle='root',offset=0,signal}={}){
    if(!(handle==='root'||UUID.test(handle))||
       !Number.isSafeInteger(offset)||offset<0||offset>10000)
      throw Error('bridge_remote_browse_invalid_request');
    if(signal?.aborted)throw Error('bridge_transfer_cancelled');
    const job=await api.requestBrowse(deviceId,{handle,offset});
    if(!UUID.test(job?.jobId)||job.deviceId!==deviceId||job.state!=='queued')
      throw Error('bridge_remote_browse_invalid_job');
    try{
      let complete=false;
      for(let attempt=0;attempt<maxPolls;attempt++){
        if(signal?.aborted)throw Error('bridge_transfer_cancelled');
        const status=await api.getStatus(job.jobId);
        if(status?.jobId!==job.jobId||status.deviceId!==deviceId)
          throw Error('bridge_remote_browse_job_mismatch');
        if(status.state==='done'){complete=true;break}
        if(!['queued','sent'].includes(status.state))
          throw Error('bridge_remote_browse_cancelled');
        await pause(pollMs);
      }
      if(!complete)throw Error('bridge_remote_browse_timeout');
      if(signal?.aborted)throw Error('bridge_transfer_cancelled');
      const page=await api.getBrowsePage(job.jobId);
      if(page?.jobId!==job.jobId||!Array.isArray(page.entries)||
         !Number.isSafeInteger(page.nextOffset))
        throw Error('bridge_remote_browse_invalid_page');
      const validated=validateBridgeFolderPage({entries:page.entries,nextOffset:page.nextOffset});
      if(validated.nextOffset!==-1&&validated.nextOffset<=offset)
        throw Error('bridge_remote_browse_pagination_loop');
      return validated;
    }finally{
      if(signal?.aborted&&typeof api.cancel==='function'){
        try{await api.cancel(job.jobId)}catch{/* revoke or already completed */}
      }
    }
  };
}
