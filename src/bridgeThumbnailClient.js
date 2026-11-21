import {downloadBridgeFile,readBridgePreviewPrefix} from './bridgeDownloadClient.js';
import {extractEmbeddedJpegThumbnail} from './bridgeExifThumbnail.js';

// Full photos are requested only for visible rows, serially, with a strict
// per-image budget. Nothing is fetched for an off-screen catalogue entry.
// A large JPEG may still have a usable EXIF thumbnail in its first 64 KiB.
export const BRIDGE_AUTO_THUMB_MAX_BYTES=4*1024*1024;
const formats=new Set(['image/jpeg','image/png','image/webp','image/gif',
  'image/heic','image/heif','image/bmp']);
const imageExtension=/\.(?:jpe?g|png|webp|gif|heic|heif|bmp)$/i;
export const canLoadBridgeThumbnail=item=>!!item&&!item.directory&&
  (formats.has(item.mime)||
   (item.mime==='application/octet-stream'&&imageExtension.test(item.name||'')))&&
  Number.isSafeInteger(item.size)&&item.size>0;

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Backend/API errors in the thumbnail-only lane must not disable the existing
// authorized read path for small images. Never downgrade on auth revocation.
const THUMBNAIL_FALLBACK_ERRORS=new Set([
  'bridge_resource_not_found','bridge_request_rejected_404',
  'bridge_backend_unavailable','bridge_network_unavailable',
  'bridge_request_failed','bridge_invalid_response',
  'bridge_thumbnail_unavailable','bridge_thumbnail_timeout',
  'bridge_thumbnail_invalid_result','bridge_thumbnail_invalid_response',
  'bridge_invalid_remote_request','bridge_request_throttled'
]);

/** Native TX produces a small JPEG under the same device and grant gates.
 * This never sends a full-sized original image for a thumbnail. */
async function nativeThumbnail({api,deviceId,item,signal}){
  const job=await api.requestThumbnail(deviceId,item.handle,{signal});
  if(!job||job.deviceId!==deviceId||typeof job.jobId!=='string'||
     job.state!=='queued')throw Error('bridge_thumbnail_invalid_job');
  let completed=false;
  try{
    const started=Date.now();
    // Native JPEG is preferred, but an unresponsive thumbnail lane must not
    // hide otherwise readable images for a full minute. Small images have
    // an existing size-verified read fallback under the 4 MiB ceiling.
    const budgetMs=item.size<=BRIDGE_AUTO_THUMB_MAX_BYTES?8000:25000;
    for(let i=0;i<26&&Date.now()-started<budgetMs;i++){
      if(signal?.aborted)throw Error('bridge_transfer_cancelled');
      const state=await api.getStatus(job.jobId,{signal});
      if(state?.jobId!==job.jobId||state.deviceId!==deviceId)
        throw Error('bridge_thumbnail_job_mismatch');
      if(state.state==='done'){
        const result=await api.getThumbnail(job.jobId,{signal});
        if(!result||result.bytesRead<4||result.bytesRead>32768||result.eof!==true)
          throw Error('bridge_thumbnail_invalid_response');
        const binary=atob(result.base64);
        if(binary.length!==result.bytesRead||binary.charCodeAt(0)!==255||
           binary.charCodeAt(1)!==216||binary.charCodeAt(binary.length-2)!==255||
           binary.charCodeAt(binary.length-1)!==217)
          throw Error('bridge_thumbnail_invalid_jpeg');
        const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
        completed=true;
        return new Blob([bytes],{type:'image/jpeg'});
      }
      if(state.state!=='queued'&&state.state!=='sent')
        throw Error('bridge_thumbnail_unavailable');
      await pause(1000);
    }
    throw Error('bridge_thumbnail_timeout');
  }finally{
    if(!completed&&typeof api.cancel==='function')
      try{await api.cancel(job.jobId)}catch{/* no grant or job expired */}
  }
}

export async function fetchBridgeThumbnail({api,deviceId,item,signal}={}){
  if(!canLoadBridgeThumbnail(item)||!api||typeof deviceId!=='string')
    throw Error('bridge_thumbnail_invalid_request');
  if(signal?.aborted)throw Error('bridge_transfer_cancelled');
  if(typeof api.requestThumbnail==='function'&&typeof api.getThumbnail==='function'&&
     typeof api.getStatus==='function'){
    try{return await nativeThumbnail({api,deviceId,item,signal});}
    catch(error){
      if(signal?.aborted||error?.message==='bridge_transfer_cancelled'||
         !THUMBNAIL_FALLBACK_ERRORS.has(error?.message))throw error;
      // The existing, authenticated file-read protocol remains a bounded
      // recovery path. Never request a full image above 4 MiB.
    }
  }
  if(item.size>BRIDGE_AUTO_THUMB_MAX_BYTES){
    if(item.mime!=='image/jpeg')return null;
    const prefix=await readBridgePreviewPrefix({
      api,deviceId,handle:item.handle,size:item.size,signal
    });
    const embedded=extractEmbeddedJpegThumbnail(prefix);
    return embedded?new Blob([embedded],{type:'image/jpeg'}):null;
  }
  const parts=[];
  let written=0,committed=false;
  const destination={
    async write(bytes,offset){
      if(signal?.aborted)throw Error('bridge_transfer_cancelled');
      if(!(bytes instanceof Uint8Array)||offset!==written||
         offset+bytes.length>item.size)throw Error('bridge_thumbnail_chunk_invalid');
      parts.push(new Uint8Array(bytes));written+=bytes.length;
    },
    async commit(){
      if(written!==item.size)throw Error('bridge_thumbnail_size_mismatch');
      committed=true;
    },
    async discard(){parts.length=0;written=0}
  };
  await downloadBridgeFile({
    api,deviceId,handle:item.handle,size:item.size,destination,signal
  });
  if(!committed||signal?.aborted)throw Error('bridge_transfer_cancelled');
  return new Blob(parts,{type:item.mime});
}

// Reduce retained thumbnail data to a bounded JPEG instead of caching full
// remote photographs. If a WebView cannot decode a format, keep the original
// bytes only if within the caller's separate cache budget.
export async function compactBridgeThumbnail(blob,{maxWidth=144}={}){
  if(!(blob instanceof Blob)||!Number.isSafeInteger(maxWidth)||maxWidth<32||maxWidth>512)
    throw Error('bridge_thumbnail_invalid_blob');
  if(typeof createImageBitmap!=='function'||typeof document==='undefined')
    return blob;
  let image;
  try{
    image=await createImageBitmap(blob,{resizeWidth:maxWidth,resizeQuality:'medium'});
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,image.width);
    canvas.height=Math.max(1,image.height);
    const ctx=canvas.getContext('2d');
    if(!ctx)return blob;
    ctx.drawImage(image,0,0,canvas.width,canvas.height);
    const small=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.72));
    return small instanceof Blob&&small.size>0?small:blob;
  }catch{
    return blob;
  }finally{
    image?.close?.();
  }
}
