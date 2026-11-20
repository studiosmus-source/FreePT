/**
 * Sequential, bounded receiver for one authorized file.
 * No broad-storage permissions. Destination is an injected staging writer:
 * commit must publish the final file, discard must delete a partial file.
 */
import {receiveBridgeFile} from '../bridge/chunkReceiver.mjs';
import {validateBridgeFileChunk,BRIDGE_FILE_LIMITS} from './bridgeFileProtocol.js';
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
  // Use large requests when TX accepts them, but back off safely if the
  // remote session cancels work. No server/TX change required.
  let currentChunk=262144;
  try{
    return await receiveBridgeFile({
      size,signal,chunkBytes:262144,
      chooseChunkBytes:()=>currentChunk,
      onReadError:(error,{length})=>{
        // Never retry a permanently failing small file merely because the
        // preferred network chunk is larger than its remaining byte count.
        if(error?.message!=='bridge_download_job_cancelled'||
           length<=65536||currentChunk<=65536)
          return false;
        currentChunk=Math.max(65536,currentChunk/2);
        return true;
      },
      write:(bytes,offset)=>destination.write(bytes,offset),
      commit:()=>destination.commit(),
      discard:()=>destination.discard(),
      onProgress,
      readChunk:async({offset,length})=>{
        if(signal?.aborted)throw Error('bridge_transfer_cancelled');
        // A foreground TX session renewal can cancel an already-dispatched
        // read job. Retry only the same byte range, never publish partial data,
        // and keep retries bounded. Revoked access still fails at requestRead.
        // One retry at larger sizes, more at 64 KiB to allow TX renewal.
        const attempts=length>65536?2:3;
        for(let retry=0;retry<attempts;retry++){
          if(signal?.aborted)throw Error('bridge_transfer_cancelled');
          const requested=await api.requestRead(deviceId,{handle,offset,length});
          activeJob=requested.jobId;
          let completed=false;
          let cancelled=false;
          for(let attempt=0;attempt<maxPolls;attempt++){
            if(signal?.aborted)throw Error('bridge_transfer_cancelled');
            const status=await api.getStatus(activeJob);
            if(status?.jobId!==activeJob||status.deviceId!==deviceId)
              throw Error('bridge_download_job_mismatch');
            if(status.state==='done'){completed=true;break}
            if(status.state==='cancelled'){cancelled=true;break}
            if(!['queued','sent'].includes(status.state))
              throw Error('bridge_download_job_cancelled');
            await pause(pollMs);
          }
          if(completed){
            if(signal?.aborted)throw Error('bridge_transfer_cancelled');
            return api.getReadChunk(activeJob);
          }
          if(!cancelled)throw Error('bridge_download_timeout');
          if(retry===attempts-1)throw Error('bridge_download_job_cancelled');
          await pause(Math.max(1000,pollMs));
        }
        throw Error('bridge_download_job_cancelled');
      }
    });
  }finally{
    if(activeJob&&signal?.aborted){
      try{await api.cancel(activeJob)}catch{/* already complete, revoked or offline */}
    }
  }
}

/**
 * Fetch just the leading bytes needed to inspect a JPEG's EXIF thumbnail.
 * Bound every step to the existing authorized read-job protocol.
 */
export async function readBridgePreviewPrefix({
  api,deviceId,handle,size,signal,pause=pauseDefault,pollMs=700,maxPolls=60
}={}){
  if(!UUID.test(deviceId)||!UUID.test(handle)||
     !Number.isSafeInteger(size)||size<1||size>BRIDGE_FILE_LIMITS.maxFileBytes||
     !api||['requestRead','getStatus','getReadChunk','cancel'].some(k=>typeof api[k]!=='function')||
     typeof pause!=='function'||!Number.isSafeInteger(pollMs)||pollMs<0||
     !Number.isSafeInteger(maxPolls)||maxPolls<1)
    throw Error('bridge_preview_invalid_options');
  const length=Math.min(size,65536);
  let jobId=null;
  try{
    for(let retry=0;retry<2;retry++){
      if(signal?.aborted)throw Error('bridge_transfer_cancelled');
      const requested=await api.requestRead(deviceId,{handle,offset:0,length});
      jobId=requested?.jobId;
      if(!UUID.test(jobId)||requested.deviceId!==deviceId)
        throw Error('bridge_preview_job_mismatch');
      let completed=false,cancelled=false;
      for(let attempt=0;attempt<maxPolls;attempt++){
        if(signal?.aborted)throw Error('bridge_transfer_cancelled');
        const status=await api.getStatus(jobId);
        if(status?.jobId!==jobId||status.deviceId!==deviceId)
          throw Error('bridge_preview_job_mismatch');
        if(status.state==='done'){completed=true;break;}
        if(status.state==='cancelled'){cancelled=true;break;}
        if(!['queued','sent'].includes(status.state))
          throw Error('bridge_preview_job_cancelled');
        await pause(pollMs);
      }
      if(completed){
        if(signal?.aborted)throw Error('bridge_transfer_cancelled');
        const chunk=validateBridgeFileChunk(await api.getReadChunk(jobId),length);
        if(chunk.bytesRead!==length)throw Error('bridge_preview_truncated');
        if(typeof Buffer!=='undefined')
          return new Uint8Array(Buffer.from(chunk.base64,'base64'));
        return Uint8Array.from(atob(chunk.base64),c=>c.charCodeAt(0));
      }
      if(!cancelled)throw Error('bridge_preview_timeout');
      if(retry===1)throw Error('bridge_preview_job_cancelled');
      await pause(Math.max(pollMs,1000));
    }
    throw Error('bridge_preview_job_cancelled');
  }finally{
    if(jobId&&signal?.aborted){
      try{await api.cancel(jobId)}catch{/* already complete or revoked */}
    }
  }
}
