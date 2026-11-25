import {downloadBridgeFile,readBridgePreviewPrefix} from './bridgeDownloadClient.js';
import {extractEmbeddedJpegThumbnail} from './bridgeExifThumbnail.js';
import {bridgePreviewPolicy} from './bridgePreviewPolicy.js';

// A list thumbnail must stay cheap for the remote phone. Every 256 KiB is one
// remote job (~7 HTTP requests in total), so a 6 MB photo used to cost ~24 jobs.
// JPEG: first look for the camera's embedded EXIF thumbnail (one 64 KiB job).
// Whole-file decoding only for small images.
export const THUMBNAIL_FULL_READ_LIMIT=1536*1024;
export const THUMBNAIL_PREFIX_BYTES=65536;
const THUMB_PX=144;

export function canLoadBridgeThumbnail(item){
  return bridgePreviewPolicy(item)?.kind==='image';
}
async function readWhole({api,deviceId,item,signal,mime}){
  const parts=[];
  let written=0;
  await downloadBridgeFile({
    api,deviceId,handle:item.handle,size:item.size,signal,
    destination:{
      async write(bytes,offset){
        if(signal?.aborted)throw Error('bridge_transfer_cancelled');
        if(offset!==written||written+bytes.length>THUMBNAIL_FULL_READ_LIMIT)
          throw Error('bridge_thumbnail_limit');
        parts.push(new Uint8Array(bytes));written+=bytes.length;
      },
      async commit(){if(written!==item.size)throw Error('bridge_thumbnail_truncated');},
      async discard(){parts.length=0;}
    }
  });
  return new Blob(parts,{type:mime});
}
export async function fetchBridgeThumbnail({api,deviceId,item,signal}={}){
  const policy=bridgePreviewPolicy(item);
  if(policy?.kind!=='image')return null;
  if(signal?.aborted)throw Error('bridge_transfer_cancelled');
  if(policy.mime==='image/jpeg'){
    const prefix=await readBridgePreviewPrefix({
      api,deviceId,handle:item.handle,size:item.size,signal
    });
    // A JPEG no larger than the prefix has just been read completely.
    if(item.size<=THUMBNAIL_PREFIX_BYTES&&prefix.length===item.size)
      return new Blob([prefix],{type:'image/jpeg'});
    const embedded=extractEmbeddedJpegThumbnail(prefix);
    if(embedded)return new Blob([embedded],{type:'image/jpeg'});
    if(item.size>THUMBNAIL_FULL_READ_LIMIT)return null;
    return readWhole({api,deviceId,item,signal,mime:policy.mime});
  }
  if(item.size>THUMBNAIL_FULL_READ_LIMIT)return null;
  return readWhole({api,deviceId,item,signal,mime:policy.mime});
}
export async function compactBridgeThumbnail(blob){
  // Square, centre-cropped thumbnail: no distortion of panoramic/tall photos.
  if(typeof createImageBitmap!=='function'||typeof document==='undefined')return blob;
  let bitmap;
  try{
    bitmap=await createImageBitmap(blob);
    const side=Math.min(bitmap.width,bitmap.height);
    if(!side)return blob;
    const canvas=document.createElement('canvas');
    canvas.width=THUMB_PX;canvas.height=THUMB_PX;
    const ctx=canvas.getContext('2d');
    if(!ctx)return blob;
    ctx.drawImage(bitmap,(bitmap.width-side)/2,(bitmap.height-side)/2,side,side,0,0,THUMB_PX,THUMB_PX);
    return await new Promise(resolve=>canvas.toBlob(b=>resolve(b||blob),'image/jpeg',0.78));
  }catch{return blob;}
  finally{bitmap?.close?.();}
}

/**
 * A visible-row queue, never an automatic download of the whole catalogue.
 * Navigation, explicit previews and downloads always take precedence.
 * Optional `store` = persistent cache {get(key),put(key,blob)}; `persistKey`
 * per row must be an opaque, already-hashed identifier (never a file name).
 */
export function createBridgeThumbnailList({
  api,deviceId,canRun,load=fetchBridgeThumbnail,compact=compactBridgeThumbnail,
  Observer=globalThis.IntersectionObserver,store=null,now=Date.now,
  createUrl=blob=>URL.createObjectURL(blob),revokeUrl=url=>URL.revokeObjectURL(url),
  retryDelayMs=15000,maxFailures=2
}){
  const rows=new Map(),cache=new Map();
  let cacheBytes=0,active=null,paused=true,stopped=false,timer=null;
  const release=row=>{
    if(row.url)revokeUrl(row.url);
    row.url=null;row.img.removeAttribute('src');row.img.hidden=true;row.icon.hidden=false;
  };
  const remember=(key,blob)=>{
    if(blob.size>12*1024*1024)return;
    if(cache.has(key)){cacheBytes-=cache.get(key).size;cache.delete(key);}
    while(cache.size>=120||cacheBytes+blob.size>12*1024*1024){
      const oldest=cache.keys().next().value;
      if(oldest===undefined)break;
      cacheBytes-=cache.get(oldest).size;cache.delete(oldest);
    }
    cache.set(key,blob);cacheBytes+=blob.size;
  };
  const schedule=delay=>{
    if(stopped||paused||timer!==null)return;
    timer=setTimeout(()=>{timer=null;pump();},delay);
  };
  const show=(row,blob)=>{
    release(row);row.url=createUrl(blob);
    // The bytes are already local: showing them never needs canRun().
    row.img.onload=()=>{
      if(row.url&&row.visible){row.img.hidden=false;row.icon.hidden=true;}
    };
    row.img.onerror=()=>{
      release(row);row.icon.title='Formato immagine non supportato da questo telefono';
    };
    row.img.src=row.url;
  };
  const pump=()=>{
    if(stopped||paused||active||timer!==null||!canRun())return;
    const time=now();
    let row=null,wait=Infinity;
    for(const candidate of rows.values()){
      if(!candidate.visible||candidate.attempted||!candidate.element.isConnected)continue;
      if(candidate.notBefore>time){wait=Math.min(wait,candidate.notBefore-time);continue;}
      row=candidate;break;
    }
    if(!row){if(wait!==Infinity)schedule(wait);return;}
    row.attempted=true;
    const task={row,abort:new AbortController(),promise:null};
    active=task;
    task.promise=(async()=>{
      let delay=150;
      try{
        let blob=cache.get(row.key);
        if(!blob&&store&&row.persistKey){
          try{const k=await row.persistKey;blob=k?await store.get(k)||null:null;}catch{blob=null;}
          if(blob)remember(row.key,blob);
        }
        if(!blob){
          delay=300;
          blob=await load({api,deviceId,item:row.item,signal:task.abort.signal});
          if(blob&&!task.abort.signal.aborted)blob=await compact(blob);
          if(blob&&!task.abort.signal.aborted){
            remember(row.key,blob);
            if(store&&row.persistKey){
              try{const k=await row.persistKey;if(k)await store.put(k,blob,{deviceId});}
              catch{/* cache is optional */}
            }
          }
        }
        if(!blob){
          row.icon.title='Miniatura non disponibile; file originale scaricabile';
          return;
        }
        if(task.abort.signal.aborted||!row.visible||!row.element.isConnected||!canRun())return;
        show(row,blob);
      }catch{
        if(!task.abort.signal.aborted){
          // Transient remote failures get a bounded, delayed second chance.
          row.failures=(row.failures||0)+1;
          if(row.failures<maxFailures){row.attempted=false;row.notBefore=now()+retryDelayMs;}
          delay=2000;row.icon.title='Miniatura non caricata. Premi Aggiorna per riprovare.';
        }
      }finally{
        if(task.abort.signal.aborted)row.attempted=false;
        if(active===task)active=null;
        schedule(delay);
      }
    })();
  };
  const observer=typeof Observer==='function'?new Observer(entries=>{
    for(const entry of entries){
      const row=rows.get(entry.target);if(!row)continue;
      row.visible=entry.isIntersecting;
      if(!row.visible){
        if(active?.row===row)active.abort.abort();
        if(row.url){release(row);row.attempted=false;}
      }
    }
    pump();
  },{root:null,rootMargin:'0px 0px 200px 0px'}):null;
  const pause=async()=>{
    paused=true;
    if(timer!==null){clearTimeout(timer);timer=null;}
    active?.abort.abort();
    await active?.promise;
  };
  const clear=()=>{
    observer?.disconnect();
    for(const row of rows.values())release(row);
    rows.clear();
  };
  return {
    track(element,item,img,icon,{persistKey=null}={}){
      const row={element,item,img,icon,visible:false,attempted:false,url:null,
        failures:0,notBefore:0,persistKey,
        key:[deviceId,item.handle,item.size,item.mime].join('|')};
      rows.set(element,row);observer?.observe(element);pump();
    },
    pause,
    resume(){if(!stopped){paused=false;pump();}},
    async reset(){await pause();clear();},
    async stop(){stopped=true;await pause();clear();cache.clear();cacheBytes=0;}
  };
}
