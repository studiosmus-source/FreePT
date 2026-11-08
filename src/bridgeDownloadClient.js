/**
 * Sequential, bounded receiver for one authorized file.
 * No broad-storage permissions. Destination is an injected staging writer:
 * commit must publish the final file, discard must delete a partial file.
 */
import {receiveBridgeFile} from '../bridge/chunkReceiver.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const pauseDefault=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function downloadBridgeFile({
  api,deviceId,handle,size,destination,signal,
  pause=pauseDefault,pollMs=700,maxPolls=60,onProgress=()=>{}
}={}){
  if(!UUID.test(deviceId)||!UUID.test(handle)||!api||
     !['requestRead','getStatus','getReadChunk','cancel'].every(k=>typeof api[k]==='function')||
     !destination||!['write','commit','discard'].every(k=>typeof destination[k]==='function')||
     typeof pause!=='function'||!Number.isSafeInteger(maxPolls)||maxPolls<1||
     !Number.isSafeInteger(pollMs)||pollMs<0)
    throw Error('bridge_download_invalid_options');
  let activeJob=null;
  try{
    return await receiveBridgeFile({
      size,signal,chunkBytes:32768,
      write:(bytes,offset)=>destination.write(bytes,offset),
      commit:()=>destination.commit(),
      discard:()=>destination.discard(),
      onProgress,
      readChunk:async({offset,length})=>{
        if(signal?.aborted)throw Error('bridge_transfer_cancelled');
        const requested=await api.requestRead(deviceId,{handle,offset,length});
        activeJob=requested.jobId;
        let completed=false;
        for(let attempt=0;attempt<maxPolls;attempt++){
          if(signal?.aborted)throw Error('bridge_transfer_cancelled');
          const status=await api.getStatus(activeJob);
          if(status?.jobId!==activeJob||status.deviceId!==deviceId)
            throw Error('bridge_download_job_mismatch');
          if(status.state==='done'){completed=true;break}
          if(status.state==='cancelled'||!['queued','sent'].includes(status.state))
            throw Error('bridge_download_job_cancelled');
          await pause(pollMs);
        }
        if(!completed)throw Error('bridge_download_timeout');
        if(signal?.aborted)throw Error('bridge_transfer_cancelled');
        return api.getReadChunk(activeJob);
      }
    });
  }finally{
    if(activeJob&&signal?.aborted){
      try{await api.cancel(activeJob)}catch{/* already complete, revoked or offline */}
    }
  }
}
