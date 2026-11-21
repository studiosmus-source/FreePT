/**
 * Isolated Android Bridge file browser. All operations are grant-gated by the
 * HTTPS backend; destination writes are confined to an owner-chosen SAF tree.
 * This UI never embeds device credentials, raw paths or server-role keys.
 */
import {createBridgeRemoteFolderLister} from './bridgeBrowseClient.js';
import {createBridgeFolderPrefetch} from './bridgeFolderPrefetch.js';
import {canLoadBridgeThumbnail,fetchBridgeThumbnail,compactBridgeThumbnail} from './bridgeThumbnailClient.js';
import {downloadBridgeFolder,inspectBridgeFolder} from './bridgeFolderDownloadClient.js';
import {downloadBridgeFile,readBridgePreviewPrefix} from './bridgeDownloadClient.js';
import {extractEmbeddedJpegThumbnail} from './bridgeExifThumbnail.js';
import {createBridgeAndroidFolderDestination,createBridgeAndroidSingleFileWriter} from './bridgeAndroidDestination.js';
import {validateBridgeFolderPage} from './bridgeFileProtocol.js';
import {filterOwnerAuthorizedDevices} from './bridgeChatDeviceFilter.js';

// Only a validated ROOT page, bound to the current authenticated receiver and
// device, is reused briefly within the same runtime. No disk or account-wide
// storage; grants are checked anew before showDevice can be reached.
const recentRoots=new WeakMap();
const ROOT_CACHE_MS=90000;
const cacheKey=(adminId,ownerId,deviceId)=>[adminId,ownerId||'',deviceId].join('|');
const getRecentRoot=(client,key)=>{
  const holder=recentRoots.get(client);
  const entry=holder?.get(key);
  if(!entry)return null;
  if(Date.now()-entry.at>ROOT_CACHE_MS){
    holder.delete(key);return null;
  }
  return entry.page;
};
const putRecentRoot=(client,key,page)=>{
  let holder=recentRoots.get(client);
  if(!holder){holder=new Map();recentRoots.set(client,holder);}
  // Single root per client at a time avoids retaining cross-chat metadata.
  holder.clear();
  holder.set(key,{page,at:Date.now()});
};

function create(node,label,parent){
  const el=document.createElement(node);
  if(label!==undefined)el.textContent=label;
  if(parent)parent.appendChild(el);
  return el;
}

export function renderBridgeRemoteFiles({
  host,db,bridgeClient,bridgeDestination,adminId,ownerId=null,ownerName=null,isAuthorized
}={}){
  if(!host||typeof db?.from!=='function'||typeof isAuthorized!=='function')
    throw Error('bridge_remote_ui_invalid_options');
  host.replaceChildren();
  let disposed=false;
  let revision=0;
  let controller=null;
  let activeDownload=false;
  let abortActiveBrowse=()=>{};
  let stopThumbnails=()=>{};
  let stopThumbnailViewportListeners=()=>{};
  let pauseThumbnails=()=>{};
  let resumeThumbnails=()=>{};
  let resumePausedFolderScan=()=>{};
  const previewClosers=new Set();
  const setBridgeBusy=value=>{host.dataset.bridgeBusy=value?'true':'false';};
  setBridgeBusy(false);
  // In-memory only, bounded cache: reopening an already viewed photo is instant.
  // Never persist remote file content, paths or authorization data.
  const previewCache=new Map();
  let previewCacheBytes=0;
  const PREVIEW_CACHE_BYTES=12*1024*1024;
  const cachePreview=(key,blob)=>{
    if(blob.size>PREVIEW_CACHE_BYTES)return;
    if(previewCache.has(key))previewCacheBytes-=previewCache.get(key).size;
    previewCache.delete(key);
    while(previewCacheBytes+blob.size>PREVIEW_CACHE_BYTES||previewCache.size>=3){
      const oldest=previewCache.keys().next().value;
      if(oldest===undefined)break;
      previewCacheBytes-=previewCache.get(oldest).size;
      previewCache.delete(oldest);
    }
    previewCache.set(key,blob);
    previewCacheBytes+=blob.size;
  };
  const cachedPreview=key=>{
    const value=previewCache.get(key);
    if(value){previewCache.delete(key);previewCache.set(key,value);}
    return value;
  };
  const clearPreviewCache=()=>{previewCache.clear();previewCacheBytes=0;};
  let moreObserver=null;
  const stopObservingMore=()=>{moreObserver?.disconnect();moreObserver=null;};
  const closePreviews=()=>{for(const close of [...previewClosers])close()};
  const alive=()=>!disposed&&host.isConnected&&isAuthorized();
  const notice=create('p',ownerId?
    'File e cartelle del telefono associato a questa persona.':
    'Seleziona un dispositivo autorizzato. Il telefono proprietario deve avere Bridge attivo e rispondere alle richieste.',host);
  const status=create('p','',host);
  status.setAttribute('role','status');
  const toolbar=create('div',undefined,host);
  const destinationButton=create('button','Scegli cartella di destinazione',toolbar);
  destinationButton.type='button';
  const refresh=create('button','Aggiorna dispositivi',toolbar);
  refresh.type='button';
  const cancel=create('button','Interrompi download',toolbar);
  cancel.type='button';cancel.hidden=true;
  const devices=create('section',undefined,host);
  const browser=create('section',undefined,host);
  const destinationReady=async()=>{
    if(!bridgeDestination)throw Error('Bridge disponibile solo nella versione Android di prova.');
    const dest=await bridgeDestination.getDestination();
    if(!dest?.selected)await bridgeDestination.chooseDestination();
    if(!alive())throw Error('Download non autorizzato');
  };
  const setStatus=value=>{if(alive())status.textContent=value};
  const remoteErrorText=error=>{
    const code=error?.message;
    if(code==='bridge_request_throttled')
      return 'Troppe richieste al server: riprova tra pochi secondi.';
    if(code==='bridge_backend_unavailable'||code==='bridge_network_unavailable')
      return 'Connessione al Bridge temporaneamente non disponibile: riprova.';
    if(code==='bridge_request_failed')
      return 'Richiesta non riuscita. Puoi riprovare senza perdere le voci già caricate.';
    if(code==='bridge_device_unavailable')
      return 'Il dispositivo remoto non è momentaneamente raggiungibile.';
    if(code==='bridge_job_already_final')
      return 'La richiesta di trasferimento è già terminata.';
    if(code==='bridge_resource_not_found')
      return 'File o richiesta non più disponibile, oppure accesso non autorizzato.';
    if(code==='bridge_invalid_remote_request')
      return 'Richiesta rifiutata dal server: dati di trasferimento non validi.';
    if(code?.startsWith('bridge_request_rejected_'))
      return 'Richiesta rifiutata dal server ('+code.slice(-3)+').';
    if(code==='bridge_destination_size_mismatch')
      return 'Il file salvato non corrisponde alla dimensione attesa: download non completato.';
    return code||'errore remoto';
  };
  const fileDownload=async(item,deviceId)=>{
    const writer=await createBridgeAndroidSingleFileWriter({
      plugin:bridgeDestination,name:item.name,size:item.size,mime:item.mime,
      ownerId,ownerName
    });
    await downloadBridgeFile({
      api:bridgeClient,deviceId,handle:item.handle,size:item.size,
      destination:writer,signal:controller.signal,
      onProgress:p=>setStatus('Download '+item.name+': '+p.receivedBytes+' / '+p.totalBytes+' byte')
    });
  };
  // Explicit, bounded previews use the same authorized Bridge read path as downloads.
  // Never fetch arbitrary remote URLs or read an entire large file for a thumbnail.
  // Only explicit user-triggered previews read remote image bytes.
  // Large image previews are bounded; automatic thumbnails are not fetched.
  const IMAGE_PREVIEW_LIMIT=8*1024*1024;
  const PDF_PREVIEW_LIMIT=2*1024*1024;
  const previewable=item=>!item.directory&&item.size>0&&
    (['image/png','image/jpeg','image/gif','image/webp'].includes(item.mime)
      ?item.size<=IMAGE_PREVIEW_LIMIT
      :item.mime==='application/pdf'&&item.size<=PDF_PREVIEW_LIMIT);
  const showPreview=async(item,deviceId)=>{
    if(activeDownload||!alive())return;
    closePreviews();
    pauseThumbnails();
    setBridgeBusy(true);
    const priorFocus=document.activeElement;
    const panel=create('section',undefined,document.body);
    panel.className='bridge-file-preview-overlay';
    panel.setAttribute('role','dialog');
    panel.setAttribute('aria-modal','true');
    panel.setAttribute('aria-label','Anteprima '+item.name);
    const header=create('header',undefined,panel);
    header.className='bridge-file-preview-header';
    const heading=create('strong',item.name,header);
    heading.className='bridge-file-preview-title';
    const close=create('button','×',header);
    close.type='button';
    close.className='bridge-file-preview-close';
    close.setAttribute('aria-label','Chiudi anteprima');
    const content=create('div',undefined,panel);
    content.className='bridge-file-preview-content';
    const message=create('p','Caricamento anteprima…',content);
    message.className='bridge-file-preview-status';
    const abort=new AbortController();
    const key=[deviceId,item.handle,item.size,item.mime].join('|');
    let url=null;
    let closed=false;
    const dismiss=()=>{
      if(closed)return;
      closed=true;
      abort.abort();
      if(url){URL.revokeObjectURL(url);url=null;}
      document.removeEventListener('keydown',onKeyDown);
      panel.remove();
      previewClosers.delete(dismiss);
      if(!activeDownload){setBridgeBusy(false);resumeThumbnails();}
      if(priorFocus?.isConnected)priorFocus.focus();
    };
    const onKeyDown=event=>{
      if(event.key==='Escape'){event.preventDefault();dismiss();}
    };
    previewClosers.add(dismiss);
    close.onclick=dismiss;
    document.addEventListener('keydown',onKeyDown);
    close.focus();
    const parts=[];
    let position=0;
    const destination={
      write:async(bytes,offset)=>{
        if(offset!==position||
           position+bytes.length>(item.mime==='application/pdf'?PDF_PREVIEW_LIMIT:IMAGE_PREVIEW_LIMIT))
          throw Error('bridge_preview_limit');
        parts.push(new Uint8Array(bytes));position+=bytes.length;
      },
      commit:async()=>{},
      discard:async()=>{parts.length=0}
    };
    const publishPreview=blob=>{
      if(closed||abort.signal.aborted)return;
      url=URL.createObjectURL(blob);
      message.remove();
      const view=document.createElement(item.mime==='application/pdf'?'iframe':'img');
      view.src=url;
      view.setAttribute('aria-label','Anteprima '+item.name);
      view.className='bridge-file-preview-media';
      if(view.tagName==='IFRAME')view.setAttribute('sandbox','');
      content.appendChild(view);
      cachePreview(key,blob);
    };
    try{
      const cached=cachedPreview(key);
      if(cached){publishPreview(cached);return;}
      if(item.mime==='image/jpeg'){
        message.textContent='Ricerca miniatura rapida…';
        const prefix=await readBridgePreviewPrefix({
          api:bridgeClient,deviceId,handle:item.handle,size:item.size,signal:abort.signal
        });
        if(closed||abort.signal.aborted||!alive()){dismiss();return;}
        const thumbnail=extractEmbeddedJpegThumbnail(prefix);
        if(thumbnail){
          publishPreview(new Blob([thumbnail],{type:item.mime}));return;
        }
        message.textContent='Caricamento foto…';
      }
      await downloadBridgeFile({
        api:bridgeClient,deviceId,handle:item.handle,size:item.size,
        destination,signal:abort.signal,
        onProgress:p=>{
          if(!closed&&!abort.signal.aborted&&alive()){
            const percentage=Math.floor(p.receivedBytes*100/p.totalBytes);
            message.textContent='Caricamento anteprima: '+percentage+'%';
          }
        }
      });
      if(closed||abort.signal.aborted||!alive()){dismiss();return;}
      publishPreview(new Blob(parts,{type:item.mime}));
    }catch(error){
      if(!closed&&!abort.signal.aborted)
        message.textContent='Anteprima non disponibile: '+remoteErrorText(error);
    }
  };
  /**
   * Show the FULL validated inventory, regardless of what the file browser
   * previously opened. Render in bounded batches, not 10k DOM nodes at once.
   */
  const reviewFolderInventory=({name,summary,manifest,signal})=>new Promise(resolve=>{
    if(signal.aborted){resolve(false);return;}
    const overlay=create('section',undefined,document.body);
    overlay.className='bridge-file-preview-overlay bridge-folder-inventory-overlay';
    overlay.setAttribute('role','dialog');
    overlay.setAttribute('aria-modal','true');
    overlay.setAttribute('aria-label','Contenuto completo di '+name);
    const header=create('header',undefined,overlay);
    header.className='bridge-file-preview-header';
    const heading=create('strong','Contenuto di '+name,header);
    heading.className='bridge-file-preview-title';
    const close=create('button','×',header);
    close.type='button';close.className='bridge-file-preview-close';
    close.setAttribute('aria-label','Annulla download cartella');
    const overview=create('p',summary.files+' file · '+summary.directories+
      ' sottocartelle · '+summary.hidden+' elementi nascosti',overlay);
    overview.className='bridge-folder-inventory-summary';
    const scroller=create('div',undefined,overlay);
    scroller.className='bridge-folder-inventory-scroll';
    const list=create('div',undefined,scroller);
    list.className='bridge-folder-inventory-entries';
    // Sort the already-verified in-memory manifest only for presentation:
    // directories first, then files, each by full path. Transfer order is unchanged.
    const inventoryItems=[...manifest].sort((a,b)=>
      Number(b.directory)-Number(a.directory)||
      a.path.join('/').localeCompare(b.path.join('/'),'it',{sensitivity:'base'}));
    const more=create('button','Mostra altre voci',scroller);
    more.type='button';more.className='bridge-folder-inventory-more';
    let shown=0,done=false;
    const showNext=()=>{
      const finish=Math.min(shown+120,inventoryItems.length);
      const fragment=document.createDocumentFragment();
      while(shown<finish){
        const entry=inventoryItems[shown++];
        const line=create('p',(entry.directory?'📁 ':'📄 ')+
          entry.path.join('/')+
          (entry.path.some(x=>x.startsWith('.'))?' · nascosto':''),fragment);
        line.className='bridge-folder-inventory-entry';
      }
      list.appendChild(fragment);
      more.hidden=shown>=inventoryItems.length;
      overview.textContent=summary.files+' file · '+summary.directories+
        ' sottocartelle · '+summary.hidden+' elementi nascosti · '+
        shown+'/'+inventoryItems.length+' voci visualizzate';
    };
    more.onclick=showNext;
    scroller.addEventListener('scroll',()=>{
      if(!more.hidden&&scroller.scrollTop+scroller.clientHeight>=scroller.scrollHeight-220)
        showNext();
    });
    showNext();
    const actions=create('div',undefined,overlay);
    actions.className='bridge-folder-inventory-actions';
    const no=create('button','Non scaricare',actions);
    no.type='button';
    const yes=create('button','Scarica '+summary.files+' file',actions);
    yes.type='button';
    const settle=accepted=>{
      if(done)return;
      done=true;
      signal.removeEventListener('abort',aborted);
      document.removeEventListener('keydown',onKeyDown);
      overlay.remove();
      resolve(accepted&&!signal.aborted);
    };
    const aborted=()=>settle(false);
    const onKeyDown=event=>{if(event.key==='Escape')settle(false)};
    signal.addEventListener('abort',aborted,{once:true});
    close.onclick=()=>settle(false);
    no.onclick=()=>settle(false);
    yes.onclick=()=>settle(true);
    close.focus();
  });
  const startDownload=async(item,deviceId,root=false)=>{
    if(activeDownload||!alive())return;
    const title=root?'Cartella condivisa':item.name;
    const isFolder=root||item.directory;
    if(!isFolder&&!confirm('Scaricare '+title+' nella cartella scelta?'))return;
    closePreviews();
    pauseThumbnails();
    activeDownload=true;setBridgeBusy(true);
    // A folder-catalogue page already in flight must not race a full scan.
    // Its offset is retained by showDevice and resumed after the download.
    abortActiveBrowse();
    cancel.hidden=false;
    controller=new AbortController();
    const signal=controller.signal;
    try{
      if(!ownerId||!ownerName)throw Error('Apri i file dalla chat della persona.');
      if(isFolder){
        // Fresh independent inventory: never trust cached UI page counts.
        let scanInfo='Scansione completa della cartella remota…';
        const startedAt=Date.now();
        const heartbeat=setInterval(()=>{
          setStatus(scanInfo+' · '+Math.floor((Date.now()-startedAt)/1000)+' s');
        },2000);
        let inspection;
        try{
          inspection=await inspectBridgeFolder({
            api:bridgeClient,deviceId,root:root?'root':item.handle,
            signal,onScanProgress:p=>{
              scanInfo='Conteggio: '+p.foundFiles+' file, '+p.foundEntries+
                ' elementi · '+p.pendingFolders+' sottocartelle da esaminare';
              setStatus(scanInfo);
            }
          });
        }finally{clearInterval(heartbeat);}
        if(signal.aborted)throw Error('bridge_transfer_cancelled');
        const {manifest,summary}=inspection;
        setStatus('Scansione completa: '+summary.files+' file in '+
          summary.directories+' sottocartelle.');
        // File names and totals are available BEFORE the user approves a
        // download. No SAF destination has been created at this point.
        const approved=await reviewFolderInventory({
          name:title,summary,manifest,signal
        });
        if(!approved){
          setStatus(signal.aborted?'Operazione annullata prima del download.':
            'Download non avviato: elenco consultato.');
          return;
        }
        setStatus('Controllo cartella di destinazione…');
        await destinationReady();
        if(signal.aborted)throw Error('bridge_transfer_cancelled');
        const writer=createBridgeAndroidFolderDestination({
          plugin:bridgeDestination,name:title,ownerId,ownerName
        });
        const result=await downloadBridgeFolder({
          api:bridgeClient,deviceId,manifest,
          destination:writer,signal,preserveCompletedOnCancel:true,
          preserveCompletedOnFailure:true,
          onStage:stage=>{
            if(stage==='destination')setStatus('Creazione cartella temporanea…');
            else if(stage==='transfer')setStatus('Scaricamento dei '+summary.files+' file…');
            else if(stage==='finalizing')setStatus('Verifica finale della cartella…');
            else if(stage==='preserving')setStatus('Salvataggio dei file completi già scaricati…');
          },
          onProgress:p=>setStatus('Completati '+p.completedFiles+'/'+summary.files+
            ' file · '+p.path.join('/')+' · '+p.fileBytes+'/'+p.fileTotalBytes+' byte')
        });
        if(result.partial){
          setStatus((result.interruptedBy==='transient_read'
            ?'Download interrotto per un errore di comunicazione. '
            :'Download annullato. ')+
            'Conservati '+result.files+'/'+summary.files+' file completi in '+
            (result.savedName||'cartella (parziale)')+
            '. Gli altri file non sono stati salvati.');
        }else setStatus('Cartella scaricata: '+result.files+' file.');
      }else{
        setStatus('Controllo cartella di destinazione…');
        await destinationReady();
        if(signal.aborted)throw Error('bridge_transfer_cancelled');
        if(item.size<0)throw Error('Dimensione del file non disponibile.');
        await fileDownload(item,deviceId);
        setStatus('File scaricato: '+item.name);
      }
    }catch(error){
      if(error?.message==='bridge_transfer_cancelled')
        setStatus('Download interrotto. Se nessun file era completo, nessuna cartella è stata salvata.');
      else setStatus('Download non riuscito: '+remoteErrorText(error));
    }finally{
      controller=null;activeDownload=false;cancel.hidden=true;
      setBridgeBusy(false);
      resumePausedFolderScan();
      resumeThumbnails();
    }
  };
  cancel.onclick=()=>{controller?.abort();setStatus('Interruzione richiesta…')};
  destinationButton.onclick=async()=>{
    if(activeDownload||!alive())return;
    try{
      await bridgeDestination.chooseDestination();
      setStatus('Cartella di destinazione selezionata.');
    }catch{setStatus('Selezione destinazione annullata o non disponibile.');}
  };
  let listingDevices=false;
  async function listDevices(){
    // A second tap on Refresh while grants are loading is not a second job.
    if(!alive()||listingDevices)return;
    listingDevices=true;
    refresh.disabled=true;
    try{await fetchListDevices();}
    finally{listingDevices=false;refresh.disabled=false;}
  }
  async function fetchListDevices(){
    if(!alive())return;
    abortActiveBrowse();
    stopThumbnails();
    const marker=++revision;
    closePreviews();
    clearPreviewCache();
    devices.replaceChildren();browser.replaceChildren();
    setStatus('Caricamento dispositivi autorizzati…');
    if(!bridgeClient||!bridgeDestination){
      setStatus('Trasferimento remoto non configurato: servono APK Bridge di prova e server HTTPS staging.');
      return;
    }
    try{
      // Join the authenticated owner's id to each receiver grant: never show
      // a different family member's phone just because the receiver is admin.
      let query=db.from('bridge_grants')
        .select('device_id,bridge_devices!inner(id,label,bridge_enabled,owner_id)')
        .eq('receiver_id',adminId).is('revoked_at',null);
      if(ownerId)query=query.eq('bridge_devices.owner_id',ownerId);
      const {data,error}=await query.limit(100);
      if(error)throw error;
      if(!alive()||marker!==revision)return;
      const allowed=filterOwnerAuthorizedDevices(data,{ownerId});
      if(!allowed.length){
        setStatus(ownerId?'Nessun telefono Bridge autorizzato per questa persona.':
          'Nessun dispositivo condiviso con questo amministratore.');
        return;
      }
      if(ownerId&&allowed.length===1){
        await showDevice(allowed[0].id,allowed[0].label||'Cartella condivisa');
        return;
      }
      create('h3',ownerId?'Telefoni di questa persona':'Telefoni condivisi con te',devices);
      for(const device of allowed){
        const row=create('div',undefined,devices);
        create('span',device.label||'Telefono Bridge',row);
        const button=create('button','Apri cartelle',row);
        button.onclick=()=>void showDevice(device.id,device.label||'Cartella condivisa');
      }
      setStatus('Seleziona un telefono per esplorare.');
    }catch{
      if(alive()&&marker===revision)setStatus('Impossibile ottenere i telefoni autorizzati.');
    }
  }
  let openingDeviceId=null;
  async function showDevice(deviceId,label){
    // Only one initial root request per device can be pending per browser.
    if(openingDeviceId===deviceId)return;
    openingDeviceId=deviceId;
    abortActiveBrowse();
    stopThumbnails();
    stopThumbnailViewportListeners();
    const marker=++revision;
    let pendingBrowse=null;
    abortActiveBrowse=()=>{pendingBrowse?.abort();pendingBrowse=null;};
    stopObservingMore();
    closePreviews();
    const stack=[{handle:'root',name:label}];
    const lister=createBridgeRemoteFolderLister({api:bridgeClient,deviceId});
    const folderPrefetch=createBridgeFolderPrefetch();
    let pausedPageOffset=null;
    let pausedPageHandle=null;
    let pausedPageNavigation=null;
    resumePausedFolderScan=()=>{
      if(activeDownload||pausedPageOffset===null||marker!==revision||!alive())return;
      const current=stack[stack.length-1];
      if(current?.handle!==pausedPageHandle||pausedPageNavigation!==navigation){
        pausedPageOffset=null;pausedPageHandle=null;pausedPageNavigation=null;
        return;
      }
      const next=pausedPageOffset;
      pausedPageOffset=null;pausedPageHandle=null;pausedPageNavigation=null;
      void display(next);
    };
    // Automatic previews run ONLY for viewport-visible images. They share the
    // authenticated Bridge read protocol and never touch remote TX settings.
    const thumbnailCache=new Map();
    let thumbnailCacheBytes=0;
    const THUMBNAIL_CACHE_BYTES=12*1024*1024;
    const thumbnailRows=new Map();
    let thumbnailObserver=null;
    let thumbnailVisibilityFrame=null;
    let thumbnailAbort=null;
    let thumbnailActive=null;
    let thumbnailGeneration=0;
    let thumbnailsAllowed=false;
    let thumbnailRetryTimer=null;
    let thumbnailNextAt=0;
    let thumbnailFailureStreak=0;
    const rememberThumbnail=(key,blob)=>{
      if(blob.size>THUMBNAIL_CACHE_BYTES)return;
      const previous=thumbnailCache.get(key);
      if(previous)thumbnailCacheBytes-=previous.size;
      thumbnailCache.delete(key);
      while(thumbnailCacheBytes+blob.size>THUMBNAIL_CACHE_BYTES||
            thumbnailCache.size>=40){
        const oldest=thumbnailCache.keys().next().value;
        if(oldest===undefined)break;
        thumbnailCacheBytes-=thumbnailCache.get(oldest).size;
        thumbnailCache.delete(oldest);
      }
      thumbnailCache.set(key,blob);
      thumbnailCacheBytes+=blob.size;
    };
    const releaseThumbnail=row=>{
      if(row.url){URL.revokeObjectURL(row.url);row.url=null;}
      row.img.removeAttribute('src');
      row.img.hidden=true;
      row.icon.hidden=false;
    };
    const stopThumbnailRows=()=>{
      thumbnailGeneration++;
      thumbnailAbort?.abort();
      thumbnailAbort=null;
      thumbnailActive=null;
      if(thumbnailRetryTimer!==null)clearTimeout(thumbnailRetryTimer);
      thumbnailRetryTimer=null;
      thumbnailNextAt=0;
      thumbnailFailureStreak=0;
      thumbnailObserver?.disconnect();
      thumbnailObserver=null;
      if(thumbnailVisibilityFrame!==null){
        cancelAnimationFrame(thumbnailVisibilityFrame);
        thumbnailVisibilityFrame=null;
      }
      for(const row of thumbnailRows.values())releaseThumbnail(row);
      thumbnailRows.clear();
      thumbnailsAllowed=false;
    };
    stopThumbnails=()=>{
      stopThumbnailRows();
      thumbnailCache.clear();
      thumbnailCacheBytes=0;
    };
    pauseThumbnails=()=>{
      if(thumbnailActive)thumbnailActive.attempted=false;
      thumbnailAbort?.abort();
      if(thumbnailRetryTimer!==null){clearTimeout(thumbnailRetryTimer);thumbnailRetryTimer=null;}
    };
    const showThumbnail=(row,blob)=>{
      if(!row.element.isConnected||!row.visible||!alive()||marker!==revision)return;
      releaseThumbnail(row);
      row.url=URL.createObjectURL(blob);
      row.img.src=row.url;
      row.img.hidden=false;
      row.icon.hidden=true;
    };
    const startVisibleThumbnail=()=>{
      if(!thumbnailsAllowed||thumbnailActive||pendingBrowse||activeDownload||
         previewClosers.size>0||!alive()||marker!==revision)return;
      const waitMs=thumbnailNextAt-Date.now();
      if(waitMs>0){
        if(thumbnailRetryTimer===null)thumbnailRetryTimer=setTimeout(()=>{
          thumbnailRetryTimer=null;
          startVisibleThumbnail();
        },waitMs);
        return;
      }
      const row=[...thumbnailRows.values()].find(item=>
        item.visible&&!item.attempted&&item.element.isConnected);
      if(!row)return;
      row.attempted=true;
      thumbnailActive=row;
      const generation=thumbnailGeneration;
      const abort=new AbortController();
      thumbnailAbort=abort;
      void (async()=>{
        try{
          let blob=thumbnailCache.get(row.key);
          if(!blob){
            blob=await fetchBridgeThumbnail({
              api:bridgeClient,deviceId,item:row.item,signal:abort.signal
            });
            if(!blob||abort.signal.aborted||generation!==thumbnailGeneration)return;
            blob=await compactBridgeThumbnail(blob);
            if(abort.signal.aborted||generation!==thumbnailGeneration)return;
            rememberThumbnail(row.key,blob);
          }
          if(abort.signal.aborted||generation!==thumbnailGeneration)return;
          showThumbnail(row,blob);
          thumbnailFailureStreak=0;
          // Keep expensive read jobs secondary to navigation and downloads.
          thumbnailNextAt=Date.now()+2000;
        }catch{
          // Bound retries per visible image to avoid flooding the remote TX.
          if(!abort.signal.aborted){
            row.failures=(row.failures||0)+1;
            if(row.failures<3)row.attempted=false;
            thumbnailFailureStreak=Math.min(4,thumbnailFailureStreak+1);
            thumbnailNextAt=Date.now()+Math.min(30000,4000*thumbnailFailureStreak);
          }
        }finally{
          if(abort.signal.aborted&&generation===thumbnailGeneration)
            row.attempted=false;
          if(thumbnailActive===row){
            thumbnailActive=null;
            thumbnailAbort=null;
          }
          if(generation===thumbnailGeneration)startVisibleThumbnail();
        }
      })();
    };
    resumeThumbnails=startVisibleThumbnail;
    // The browser must not depend solely on IntersectionObserver callbacks:
    // some embedded Android WebViews defer them while the folder list is
    // being replaced. Reconcile on the next paint, before starting a job.
    const refreshThumbnailViewport=()=>{
      const height=window.innerHeight||document.documentElement.clientHeight;
      const width=window.innerWidth||document.documentElement.clientWidth;
      for(const row of thumbnailRows.values()){
        if(!row.element.isConnected)continue;
        const bounds=row.element.getBoundingClientRect();
        const visible=bounds.bottom>-60&&bounds.top<height+60&&
          bounds.right>0&&bounds.left<width;
        if(!visible){
          if(thumbnailActive===row){row.attempted=false;thumbnailAbort?.abort();}
          if(row.url){releaseThumbnail(row);row.attempted=false;}
        }
        row.visible=visible;
      }
      startVisibleThumbnail();
    };
    const scheduleThumbnailViewport=()=>{
      if(thumbnailVisibilityFrame!==null||!alive())return;
      thumbnailVisibilityFrame=requestAnimationFrame(()=>{
        thumbnailVisibilityFrame=null;
        if(alive()&&marker===revision)refreshThumbnailViewport();
      });
    };
    const trackThumbnail=(element,item,img,icon)=>{
      if(!thumbnailObserver&&typeof IntersectionObserver==='function'){
        thumbnailObserver=new IntersectionObserver(entries=>{
          for(const entry of entries){
            const row=thumbnailRows.get(entry.target);
            if(!row)continue;
            row.visible=entry.isIntersecting;
            if(!row.visible){
              if(thumbnailActive===row){row.attempted=false;thumbnailAbort?.abort();}
              if(row.url){releaseThumbnail(row);row.attempted=false;}
            }
          }
          startVisibleThumbnail();
        },{root:null,rootMargin:'0px 0px 60px 0px'});
      }
      const row={element,item,img,icon,visible:false,attempted:false,url:null,
        key:[deviceId,item.handle,item.size,item.mime].join('|')};
      thumbnailRows.set(element,row);
      thumbnailObserver?.observe(element);
      scheduleThumbnailViewport();
    };

    // Capture nested scrolling containers without new controls or polling.
    window.addEventListener('scroll',scheduleThumbnailViewport,{passive:true,capture:true});
    window.addEventListener('resize',scheduleThumbnailViewport,{passive:true});
    stopThumbnailViewportListeners=()=>{
      window.removeEventListener('scroll',scheduleThumbnailViewport,true);
      window.removeEventListener('resize',scheduleThumbnailViewport);
    };
    const history=()=>stack.map(x=>x.name).join(' / ');
    // Session-only cache: navigating Back must not issue the same remote jobs.
    // Do not persist remote filenames or ephemeral file handles to storage.
    const folderPages=new Map();
    const rootCacheKey=cacheKey(adminId,ownerId,deviceId);
    const rootCached=getRecentRoot(bridgeClient,rootCacheKey);
    if(rootCached)folderPages.set('root|0',rootCached);
    let navigation=0;
    async function display(offset=0){
      if(!alive()||marker!==revision)return;
      if(activeDownload){
        if(offset>0){
          pausedPageOffset=offset;
          pausedPageHandle=stack[stack.length-1]?.handle;
          pausedPageNavigation=navigation;
        }
        setStatus('Download in corso. La ricerca cartelle riprenderà alla fine.');
        return false;
      }
      pendingBrowse?.abort();
      const currentBrowse=new AbortController();
      pendingBrowse=currentBrowse;
      const view=++navigation;
      const current=stack[stack.length-1];
      const key=current.handle+'|'+offset;
      if(offset>0){
        pausedPageOffset=offset;
        pausedPageHandle=current.handle;
        pausedPageNavigation=view;
      }
      if(offset===0){
        stopObservingMore();stopThumbnailRows();closePreviews();browser.replaceChildren();
        pausedPageOffset=null;pausedPageHandle=null;pausedPageNavigation=null;
      }
      if(!folderPages.has(key))setStatus('Richiesta elenco '+history()+'…');
      try{
        const cached=folderPages.get(key);
        const page=cached??validateBridgeFolderPage(await lister({
          handle:current.handle,offset,signal:currentBrowse.signal,
          onProgress:progress=>{
            if(!alive()||marker!==revision||view!==navigation||
               currentBrowse.signal.aborted)return;
            const waiting=progress.state==='queued';
            const elapsed=progress.elapsedSeconds;
            setStatus((waiting
              ?'In attesa che il telefono remoto risponda'
              :'Il telefono remoto sta elaborando l’elenco')+
              ' · '+elapsed+' s'+
              (elapsed>=30?' · Risposta lenta del Bridge':''));
          }
        }));
        if(!alive()||marker!==revision||view!==navigation)return;
        if(!cached)folderPages.set(key,page);
        if(current.handle==='root'&&offset===0&&!cached){
          putRecentRoot(bridgeClient,rootCacheKey,page);
        }
        if(offset===0){
          const nav=create('nav',undefined,browser);
          nav.className='bridge-breadcrumbs';
          nav.setAttribute('aria-label','Percorso cartelle');
          stack.forEach((segment,index)=>{
            const crumb=create('button',segment.name,nav);
            crumb.type='button';
            crumb.disabled=index===stack.length-1;
            crumb.onclick=()=>{stack.splice(index+1);void display()};
            if(index<stack.length-1)create('span',' › ',nav);
          });
          const actions=create('div',undefined,browser);
          actions.className='bridge-folder-actions';
          const download=create('button','Scarica cartella',actions);
          download.onclick=()=>void startDownload(
            {name:current.name,handle:current.handle,directory:true},deviceId,
            current.handle==='root');
          const reload=create('button','Aggiorna',actions);
          reload.onclick=()=>{
            for(const pageKey of folderPages.keys())
              if(pageKey.startsWith(current.handle+'|'))folderPages.delete(pageKey);
            if(current.handle==='root')recentRoots.get(bridgeClient)?.delete(rootCacheKey);
            void display();
          };
          const completeness=create('p','',browser);
          completeness.className='bridge-folder-completeness';
          const list=create('div',undefined,browser);
          list.className='bridge-remote-entries';
          const foldersTitle=create('h4','Cartelle',list);
          foldersTitle.className='bridge-list-section-heading';
          foldersTitle.hidden=true;
          create('div',undefined,list).className='bridge-remote-folders';
          const folderDiscovery=create('p','',list);
          folderDiscovery.className='bridge-folder-discovery-status';
          folderDiscovery.hidden=true;
          const filesTitle=create('h4','File',list);
          filesTitle.className='bridge-list-section-heading';
          filesTitle.hidden=true;
          create('div',undefined,list).className='bridge-remote-files';
        }
        const list=browser.querySelector('.bridge-remote-entries');
        if(offset>0){
          // A page interrupted by a download can be retried directly. Remove
          // its old load-more action so two buttons do not remain on screen.
          for(const previous of list.querySelectorAll('.bridge-load-more'))
            previous.remove();
        }
        const folders=list.querySelector('.bridge-remote-folders');
        const files=list.querySelector('.bridge-remote-files');
        for(const item of page.entries){
          const target=item.directory?folders:files;
          target.previousElementSibling.hidden=false;
          const line=create('div',undefined,target);
          line.className='bridge-entry';
          const hidden=item.name.startsWith('.');
          line.dataset.bridgeHidden=hidden?'true':'false';
          const canThumbnail=canLoadBridgeThumbnail(item);
          const primary=create('button',canThumbnail?undefined:
            (item.directory?'📁 ':'📄 ')+item.name,line);
          primary.className='bridge-entry-primary';
          primary.type='button';
          if(canThumbnail){
            primary.classList.add('bridge-entry-photo-button');
            const icon=create('span','🖼️',primary);
            icon.className='bridge-entry-photo-icon';
            const img=create('img',undefined,primary);
            img.className='bridge-entry-photo-thumb';
            img.alt='';img.hidden=true;
            const name=create('span',item.name,primary);
            name.className='bridge-entry-photo-name';
            trackThumbnail(line,item,img,icon);
          }
          if(hidden){
            const marker=create('small','nascosto',line);
            marker.className='bridge-hidden-label';
          }
          primary.onclick=()=>item.directory?
            (stack.push({handle:item.handle,name:item.name}),void display()):
            (previewable(item)?void showPreview(item,deviceId):void startDownload(item,deviceId));
          const menu=create('details',undefined,line);
          menu.className='bridge-entry-menu';
          const trigger=create('summary','⋮',menu);
          trigger.setAttribute('aria-label','Opzioni per '+item.name);
          const options=create('div',undefined,menu);
          const download=create('button',item.directory?'Scarica cartella':'Scarica file',options);
          download.onclick=()=>{menu.open=false;void startDownload(item,deviceId)};
          if(previewable(item)){
            const preview=create('button','Anteprima',options);
            preview.onclick=()=>{menu.open=false;void showPreview(item,deviceId)};
          }
          if(!item.directory){
            const details=create('small',item.size+' byte · '+item.mime,options);
          }
        }
        // Pages can arrive file-first from older remote Bridge builds. Keep
        // the already loaded file rows usable while discovering folders ahead
        // of them across later pages. Do not require changes on the owner TX.
        const scan=folderPrefetch.record({handle:current.handle,offset,page});
        const directoriesFound=folders.querySelectorAll('.bridge-entry').length;
        pausedPageOffset=scan.autoFetch?page.nextOffset:null;
        pausedPageHandle=scan.autoFetch?current.handle:null;
        pausedPageNavigation=scan.autoFetch?view:null;
        thumbnailsAllowed=!scan.autoFetch;
        const folderNotice=list.querySelector('.bridge-folder-discovery-status');
        if(folderNotice){
          folderNotice.hidden=!scan.pending;
          if(scan.pending){
            folders.previousElementSibling.hidden=false;
            folderNotice.textContent=scan.atLimit
              ? 'Limite di navigazione raggiunto: elenco NON completo. Cartelle trovate: '+
                directoriesFound+'.'
              : 'Ricerca di tutte le sottocartelle… '+directoriesFound+
                ' trovate · '+scan.pagesRead+' pagine verificate.';
          }else if(!folders.children.length){
            folders.previousElementSibling.hidden=true;
          }
        }
        if(page.nextOffset!==-1){
          const more=create('button','Carica altri file e cartelle',list);
          more.className='bridge-load-more';
          // Keep the retry button near the directory heading when scanning:
          // file-first catalogues may have hundreds of entries below it.
          if(scan.pending)list.insertBefore(more,files.previousElementSibling);
          // Load subsequent pages one at a time; never enqueue in parallel. Large folders must stay
          // navigable while earlier entries are available, even on a slow TX.
          // Keep the retry control if an individual page request fails.
          more.onclick=async()=>{
            if(more.disabled||activeDownload||!more.isConnected||view!==navigation)return;
            stopObservingMore();
            more.disabled=true;
            const loaded=await display(page.nextOffset);
            if(loaded)more.remove();
            else if(more.isConnected)more.disabled=false;
          };
          // Legacy TX sometimes sends ALL files before two directories in
          // its final page. Scan ahead in a bounded sequential batch while
          // preserving existing rows and an explicit retry on any failure.
          if(scan.autoFetch){
            void Promise.resolve().then(()=>{
              if(more.isConnected&&!more.disabled&&view===navigation)
                void more.onclick();
            });
          }else if(!scan.atLimit&&typeof IntersectionObserver==='function'){
            moreObserver=new IntersectionObserver(entries=>{
              if(entries.some(entry=>entry.isIntersecting)&&more.isConnected&&
                 !more.disabled&&view===navigation){
                void more.onclick();
              }
            },{root:null,rootMargin:'0px 0px 180px 0px'});
            moreObserver.observe(more);
          }
        }
        if(!page.entries.length&&offset===0)create('p','Cartella vuota.',list);
        const rows=list.querySelectorAll('.bridge-entry');
        const hiddenRows=list.querySelectorAll('.bridge-entry[data-bridge-hidden="true"]');
        const completeness=browser.querySelector('.bridge-folder-completeness');
        if(completeness)completeness.textContent=
          'Elementi caricati: '+rows.length+' · Cartelle: '+directoriesFound+
          ' · Nascosti: '+hiddenRows.length+
          (page.nextOffset===-1
            ? ' · Fine elenco trasmesso dal telefono (cartella completa)'
            :scan.atLimit
              ? ' · Elenco non completo: limite di navigazione'
              :scan.autoFetch
                ? ' · Ricerca automatica delle sottocartelle in corso'
                : ' · Elenco parziale: carica le altre pagine');
        setStatus(scan.autoFetch
          ? 'Ricerca completa delle sottocartelle: pagina '+scan.pagesRead+
            ', trovate '+directoriesFound+' cartelle…'
          :cached&&current.handle==='root'&&offset===0
            ? 'Elenco principale recente (in memoria). Premi Aggiorna per verificarlo sul telefono.'
          :page.nextOffset===-1
            ? 'Fine elenco trasmesso dal telefono.'
            : 'Altri elementi disponibili: scorri per continuare.');
        return true;
      }catch(error){
        if(!currentBrowse.signal.aborted&&offset>0){
          // A failed catalogue page must not permanently block existing
          // viewport thumbnails. Keep manual page retry and loaded rows.
          thumbnailsAllowed=true;
          const interrupted=browser.querySelector('.bridge-folder-discovery-status');
          if(interrupted&&!interrupted.hidden)
            interrupted.textContent='Ricerca sottocartelle interrotta. '+
              'Usa Carica altri file e cartelle per riprendere.';
          const summary=browser.querySelector('.bridge-folder-completeness');
          if(summary)summary.textContent=summary.textContent.replace(
            'Ricerca automatica delle sottocartelle in corso',
            'Ricerca interrotta: file caricati conservati');
        }
        if(currentBrowse.signal.aborted){
          if(activeDownload&&offset>0){
            pausedPageOffset=offset;
            pausedPageHandle=current.handle;
            pausedPageNavigation=view;
          }
          return false;
        }
        setStatus(offset>=10000&&
          ['bridge_file_page_invalid','bridge_remote_browse_invalid_page'].includes(error?.message)
          ?'Elenco incompleto: il Bridge remoto supera il limite tecnico di paginazione. Le cartelle già trovate restano disponibili.'
          :error?.message==='bridge_remote_browse_expired'
          ?'Richiesta scaduta: nessuna risposta entro il termine. Riprova da questa schermata.'
          :error?.message==='bridge_remote_browse_timeout'
            ?'Il telefono remoto non ha risposto entro il limite di attesa. Riprova da questa schermata.'
            :'Elenco non disponibile: '+remoteErrorText(error));
        return false;
      }finally{
        if(pendingBrowse===currentBrowse)pendingBrowse=null;
        // The catalogue is fully mounted here. Detect the actual visible
        // images synchronously; do not rely on an observer/animation frame
        // that an embedded WebView can defer until the next interaction.
        refreshThumbnailViewport();
        scheduleThumbnailViewport();
      }
    }
    try{await display();}
    finally{if(openingDeviceId===deviceId)openingDeviceId=null;}
  }
  refresh.onclick=()=>{
    // Explicit refresh must never silently show stale remote metadata.
    recentRoots.get(bridgeClient)?.clear();
    void listDevices();
  };
  void listDevices();
  return ()=>{
    disposed=true;revision++;
    controller?.abort();
    abortActiveBrowse();
    stopObservingMore();
    stopThumbnails();
    stopThumbnailViewportListeners();
    closePreviews();
    clearPreviewCache();
    setBridgeBusy(false);
  };
}
