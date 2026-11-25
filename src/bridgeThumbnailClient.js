import {downloadBridgeFile,readBridgePreviewPrefix} from './bridgeDownloadClient.js';
import {extractEmbeddedJpegThumbnail} from './bridgeExifThumbnail.js';
import {bridgePreviewPolicy,IMAGE_PREVIEW_LIMIT} from './bridgePreviewPolicy.js';

export function canLoadBridgeThumbnail(item){
  return bridgePreviewPolicy(item)?.kind==='image';
}
export async function fetchBridgeThumbnail({api,deviceId,item,signal}={}){
  const policy=bridgePreviewPolicy(item);
  if(policy?.kind!=='image')return null;
  if(signal?.aborted)throw Error('bridge_transfer_cancelled');
  if(policy.embeddedOnly){
    const prefix=await readBridgePreviewPrefix({
      api,deviceId,handle:item.handle,size:item.size,signal
    });
    const embedded=extractEmbeddedJpegThumbnail(prefix);
    return embedded?new Blob([embedded],{type:'image/jpeg'}):null;
  }
  const parts=[];
  let written=0;
  await downloadBridgeFile({
    api,deviceId,handle:item.handle,size:item.size,signal,
    destination:{
      async write(bytes,offset){
        if(signal?.aborted)throw Error('bridge_transfer_cancelled');
        if(offset!==written||written+bytes.length>IMAGE_PREVIEW_LIMIT)
          throw Error('bridge_thumbnail_limit');
        parts.push(new Uint8Array(bytes));written+=bytes.length;
      },
      async commit(){if(written!==item.size)throw Error('bridge_thumbnail_truncated');},
      async discard(){parts.length=0;}
    }
  });
  return new Blob(parts,{type:policy.mime});
}
export async function compactBridgeThumbnail(blob){
  // Keep both dimensions bounded, including panoramic and very tall photos.
  if(typeof createImageBitmap!=='function')return blob;
  let bitmap;
  try{
    bitmap=await createImageBitmap(blob,{resizeWidth:144,resizeHeight:144,resizeQuality:'low'});
    const canvas=document.createElement('canvas');
    canvas.width=144;canvas.height=144;
    const ctx=canvas.getContext('2d');
    if(!ctx)return blob;
    ctx.drawImage(bitmap,0,0,144,144);
    return await new Promise(resolve=>canvas.toBlob(b=>resolve(b||blob),'image/jpeg',0.75));
  }catch{return blob;}
  finally{bitmap?.close();}
}

/**
 * A visible-row queue, never an automatic download of the whole catalogue.
 * Navigation, explicit previews and downloads always take precedence.
 */
export function createBridgeThumbnailList({
  api,deviceId,canRun,load=fetchBridgeThumbnail,compact=compactBridgeThumbnail,
  Observer=globalThis.IntersectionObserver,
  createUrl=blob=>URL.createObjectURL(blob),revokeUrl=url=>URL.revokeObjectURL(url)
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
    while(cache.size>=40||cacheBytes+blob.size>12*1024*1024){
      const oldest=cache.keys().next().value;
      cacheBytes-=cache.get(oldest).size;cache.delete(oldest);
    }
    cache.set(key,blob);cacheBytes+=blob.size;
  };
  const pump=()=>{
    if(stopped||paused||active||timer!==null||!canRun())return;
    const row=[...rows.values()].find(r=>r.visible&&!r.attempted&&r.element.isConnected);
    if(!row)return;
    row.attempted=true;
    const task={row,abort:new AbortController(),promise:null};
    active=task;
    task.promise=(async()=>{
      let delay=300;
      try{
        let blob=cache.get(row.key);
        if(!blob){
          blob=await load({api,deviceId,item:row.item,signal:task.abort.signal});
          if(blob&&!task.abort.signal.aborted)blob=await compact(blob);
          if(blob&&!task.abort.signal.aborted)remember(row.key,blob);
        }
        if(!blob){
          row.icon.title='Miniatura non disponibile; file originale scaricabile';
          return;
        }
        if(task.abort.signal.aborted||!row.visible||!row.element.isConnected||!canRun())return;
        release(row);row.url=createUrl(blob);
        row.img.onload=()=>{
          if(row.url&&row.visible&&canRun()){row.img.hidden=false;row.icon.hidden=true;}
        };
        row.img.onerror=()=>{
          release(row);row.icon.title='Formato immagine non supportato da questo telefono';
        };
        row.img.src=row.url;
      }catch{
        if(!task.abort.signal.aborted){
          delay=4000;row.icon.title='Miniatura non caricata. Premi Aggiorna per riprovare.';
        }
      }finally{
        if(task.abort.signal.aborted)row.attempted=false;
        if(active===task)active=null;
        if(!stopped&&!paused){
          timer=setTimeout(()=>{timer=null;pump();},delay);
        }
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
  },{root:null,rootMargin:'0px'}):null;
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
    track(element,item,img,icon){
      const row={element,item,img,icon,visible:false,attempted:false,url:null,
        key:[deviceId,item.handle,item.size,item.mime].join('|')};
      rows.set(element,row);observer?.observe(element);pump();
    },
    pause,
    resume(){if(!stopped){paused=false;pump();}},
    async reset(){await pause();clear();},
    async stop(){stopped=true;await pause();clear();cache.clear();cacheBytes=0;}
  };
}
