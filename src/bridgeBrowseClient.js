import {validateBridgeFolderPage} from './bridgeFileProtocol.js';

/**
 * Authenticated remote directory browsing: one paginated job per SAF page.
 * No document URI or local filesystem path crosses the API. Each server job
 * must be authorized against the owner's selected folder and current grant.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// The server queues browse jobs for 60 seconds. Stop waiting before an
// unclaimable job can leave the admin browser spinning indefinitely.
const BROWSE_WAIT_MS=55_000;
export function createBridgeRemoteFolderLister({
  api,deviceId,pause=wait,pollMs=1200,maxPolls=90,now=Date.now
}={}){
  if(!UUID.test(deviceId)||!api||
     ['requestBrowse','getStatus','getBrowsePage'].some(k=>typeof api[k]!=='function')||
     typeof pause!=='function'||typeof now!=='function'||
     !Number.isSafeInteger(pollMs)||pollMs<0||
     !Number.isSafeInteger(maxPolls)||maxPolls<1)
    throw Error('bridge_remote_browse_invalid_options');

  return async function listPage({handle='root',offset=0,signal,onProgress=()=>{}}={}){
    if(!(handle==='root'||UUID.test(handle))||
       !Number.isSafeInteger(offset)||offset<0||offset>10000)
      throw Error('bridge_remote_browse_invalid_request');
    if(typeof onProgress!=='function')throw Error('bridge_remote_browse_invalid_request');
    if(signal?.aborted)throw Error('bridge_transfer_cancelled');
    const startedAt=now();
    const job=await api.requestBrowse(deviceId,{handle,offset},{signal});
    if(!UUID.test(job?.jobId)||job.deviceId!==deviceId||job.state!=='queued')
      throw Error('bridge_remote_browse_invalid_job');
    let success=false;
    let lastProgress=0;
    let lastState='';
    try{
      if(now()-startedAt>=BROWSE_WAIT_MS)throw Error('bridge_remote_browse_timeout');
      let complete=false;
      for(let attempt=0;attempt<maxPolls;attempt++){
        if(signal?.aborted)throw Error('bridge_transfer_cancelled');
        const status=await api.getStatus(job.jobId,{signal});
        if(status?.jobId!==job.jobId||status.deviceId!==deviceId)
          throw Error('bridge_remote_browse_job_mismatch');
        if(status.state==='done'){complete=true;break}
        if(status.state==='expired')throw Error('bridge_remote_browse_expired');
        if(['queued','sent'].includes(status.state)){
          const currentTime=now();
          if(currentTime-startedAt>=BROWSE_WAIT_MS)
            throw Error('bridge_remote_browse_timeout');
          if(status.state!==lastState||currentTime-lastProgress>=5000){
            onProgress({state:status.state,elapsedSeconds:Math.max(0,Math.floor((currentTime-startedAt)/1000))});
            lastState=status.state;
            lastProgress=currentTime;
          }
        }
        if(!['queued','sent'].includes(status.state))
          throw Error('bridge_remote_browse_cancelled');
        await pause(pollMs);
      }
      if(!complete)throw Error('bridge_remote_browse_timeout');
      if(signal?.aborted)throw Error('bridge_transfer_cancelled');
      const page=await api.getBrowsePage(job.jobId,{signal});
      if(page?.jobId!==job.jobId||!Array.isArray(page.entries)||
         !Number.isSafeInteger(page.nextOffset))
        throw Error('bridge_remote_browse_invalid_page');
      const validated=validateBridgeFolderPage({entries:page.entries,nextOffset:page.nextOffset});
      if(validated.nextOffset!==-1&&validated.nextOffset<=offset)
        throw Error('bridge_remote_browse_pagination_loop');
      success=true;
      return validated;
    }finally{
      // Timed-out and interrupted jobs must not accumulate on TX's FIFO.
      // Cancelling a completed job is unnecessary; revoked access still fails.
      if(!success&&typeof api.cancel==='function'){
        try{await api.cancel(job.jobId)}catch{/* already completed/revoked/offline */}
      }
    }
  };
}
