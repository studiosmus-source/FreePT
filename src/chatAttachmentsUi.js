/**
 * Renders one chat attachment inside a message bubble, in-app.
 *   image -> inline thumbnail, tap opens a fullscreen in-app viewer (no Chrome)
 *   video/audio -> inline native controls
 *   pdf/other -> a labelled row
 * Every attachment gets a «Scarica» action that writes to a folder the user
 * picks and confirms ONLY after the file is actually saved.
 *
 * All external access goes through injected helpers so this stays testable:
 *   signUrl(path)        -> Promise<string>   (fresh, longer-lived signed URL)
 *   makeWriter({name,size,mime}) -> Promise<writer|null>  (SAF single-file)
 *   escape(str)          -> safe text
 */
import {attachmentKind,attachmentMime} from './chatAttachments.js';
import {encodeBridgeBytes} from './bridgeAndroidDestination.js';

function el(tag,props={},parent){
  const node=document.createElement(tag);
  Object.assign(node,props);
  if(parent)parent.appendChild(node);
  return node;
}

function openFullscreen(kind,url,name,escape){
  const shade=el('div',{className:'attach-viewer-shade',role:'dialog'},document.body);
  shade.setAttribute('aria-modal','true');
  shade.setAttribute('aria-label',name||'Allegato');
  const close=()=>shade.remove();
  shade.onclick=event=>{if(event.target===shade)close();};
  const bar=el('div',{className:'attach-viewer-bar'},shade);
  el('strong',{textContent:name||'Allegato'},bar);
  el('button',{type:'button',textContent:'Chiudi',onclick:close},bar);
  if(kind==='video'){
    const v=el('video',{controls:true,autoplay:true,className:'attach-viewer-media'},shade);
    v.src=url;
  }else{
    const img=el('img',{className:'attach-viewer-media',alt:name||'Immagine'},shade);
    img.src=url;
  }
}

export function renderChatAttachment({container,fileName,filePath,signUrl,makeWriter,escape=(s=>String(s)),setStatus=(()=>{})}={}){
  if(!container||typeof signUrl!=='function')return;
  const kind=attachmentKind(fileName);
  const mime=attachmentMime(fileName);
  const wrap=el('div',{className:'attach attach-'+kind},container);

  const download=async()=>{
    try{
      setStatus('Preparazione download…');
      const url=await signUrl(filePath);
      const res=await fetch(url);
      if(!res.ok)throw Error('fetch');
      const buf=new Uint8Array(await res.arrayBuffer());
      const writer=makeWriter?await makeWriter({name:fileName||'allegato',size:buf.byteLength,mime}):null;
      if(!writer){
        // Fallback: in-memory blob link (no folder choice available here).
        const a=el('a',{href:URL.createObjectURL(new Blob([buf],{type:mime})),download:fileName||'allegato'});
        a.click();setTimeout(()=>URL.revokeObjectURL(a.href),10000);
        setStatus('File pronto.');return;
      }
      for(let off=0;off<buf.byteLength;off+=32768)
        await writer.write(buf.subarray(off,Math.min(off+32768,buf.byteLength)),off);
      await writer.commit();
      setStatus('File salvato nella cartella scelta.');
    }catch(error){
      setStatus('Download non riuscito: '+(error&&error.message||'errore'));
    }
  };

  if(kind==='image'){
    const img=el('img',{className:'attach-thumb',alt:escape(fileName||'Immagine'),loading:'lazy'},wrap);
    img.onerror=()=>{img.replaceWith(el('span',{textContent:'📷 '+escape(fileName||'Immagine')}));};
    signUrl(filePath).then(u=>{img.src=u;}).catch(()=>{});
    img.onclick=async()=>{try{openFullscreen('image',await signUrl(filePath),fileName,escape);}catch{}};
  }else if(kind==='video'){
    const v=el('video',{className:'attach-thumb',controls:true,preload:'metadata'},wrap);
    signUrl(filePath).then(u=>{v.src=u;}).catch(()=>{});
  }else if(kind==='audio'){
    const a=el('audio',{controls:true,preload:'metadata'},wrap);
    signUrl(filePath).then(u=>{a.src=u;}).catch(()=>{});
  }else{
    el('span',{className:'attach-name',textContent:(kind==='pdf'?'📄 ':'📎 ')+escape(fileName||'Allegato')},wrap);
  }
  const actions=el('div',{className:'attach-actions'},wrap);
  el('button',{type:'button',className:'attach-download',textContent:'Scarica',onclick:download},actions);
  return wrap;
}
