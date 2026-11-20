import {downloadBridgeFile,readBridgePreviewPrefix} from './bridgeDownloadClient.js';
import {extractEmbeddedJpegThumbnail} from './bridgeExifThumbnail.js';

// Full photos are requested only for visible rows, serially, with a strict
// per-image budget. Nothing is fetched for an off-screen catalogue entry.
// A large JPEG may still have a usable EXIF thumbnail in its first 64 KiB.
export const BRIDGE_AUTO_THUMB_MAX_BYTES=4*1024*1024;
const formats=new Set(['image/jpeg','image/png','image/webp','image/gif']);
export const canLoadBridgeThumbnail=item=>!!item&&!item.directory&&
  formats.has(item.mime)&&Number.isSafeInteger(item.size)&&item.size>0;

export async function fetchBridgeThumbnail({api,deviceId,item,signal}={}){
  if(!canLoadBridgeThumbnail(item)||!api||typeof deviceId!=='string')
    throw Error('bridge_thumbnail_invalid_request');
  if(signal?.aborted)throw Error('bridge_transfer_cancelled');
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
