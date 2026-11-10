/**
 * Isolated Android Bridge file browser. All operations are grant-gated by the
 * HTTPS backend; destination writes are confined to an owner-chosen SAF tree.
 * This UI never embeds device credentials, raw paths or server-role keys.
 */
import {createBridgeRemoteFolderLister} from './bridgeBrowseClient.js';
import {downloadBridgeFolder} from './bridgeFolderDownloadClient.js';
import {downloadBridgeFile} from './bridgeDownloadClient.js';
import {createBridgeAndroidFolderDestination,createBridgeAndroidSingleFileWriter} from './bridgeAndroidDestination.js';
import {validateBridgeFolderPage} from './bridgeFileProtocol.js';
import {filterOwnerAuthorizedDevices} from './bridgeChatDeviceFilter.js';

function create(node,label,parent){
  const el=document.createElement(node);
  if(label!==undefined)el.textContent=label;
  if(parent)parent.appendChild(el);
  return el;
}

export function renderBridgeRemoteFiles({
  host,db,bridgeClient,bridgeDestination,adminId,ownerId=null,isAuthorized
}={}){
  if(!host||typeof db?.from!=='function'||typeof isAuthorized!=='function')
    throw Error('bridge_remote_ui_invalid_options');
  host.replaceChildren();
  let disposed=false;
  let revision=0;
  let controller=null;
  let activeDownload=false;
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
    if(!dest?.selected)throw Error('Scegli prima la cartella di destinazione.');
  };
  const setStatus=value=>{if(alive())status.textContent=value};
  const fileDownload=async(item,deviceId)=>{
    const writer=await createBridgeAndroidSingleFileWriter({
      plugin:bridgeDestination,name:item.name,size:item.size,mime:item.mime
    });
    await downloadBridgeFile({
      api:bridgeClient,deviceId,handle:item.handle,size:item.size,
      destination:writer,signal:controller.signal,
      onProgress:p=>setStatus('Download '+item.name+': '+p.receivedBytes+' / '+p.totalBytes+' byte')
    });
  };
  // Explicit, bounded previews use the same authorized Bridge read path as downloads.
  // Never fetch arbitrary remote URLs or read an entire large file for a thumbnail.
  const PREVIEW_LIMIT=2*1024*1024;
  const previewable=item=>!item.directory&&item.size>0&&item.size<=PREVIEW_LIMIT&&
    (item.mime.startsWith('image/')&&['image/png','image/jpeg','image/gif','image/webp'].includes(item.mime)||
     item.mime==='application/pdf');
  const showPreview=async(item,deviceId)=>{
    if(activeDownload||!alive())return;
    const panel=create('section',undefined,browser);
    panel.className='bridge-file-preview';
    const heading=create('strong',item.name,panel);
    const close=create('button','Chiudi anteprima',panel);
    const message=create('p','Caricamento anteprima…',panel);
    const abort=new AbortController();
    let url=null;
    close.onclick=()=>{abort.abort();if(url)URL.revokeObjectURL(url);panel.remove()};
    const parts=[];
    let position=0;
    const destination={
      write:async(bytes,offset)=>{
        if(offset!==position||position+bytes.length>PREVIEW_LIMIT)throw Error('bridge_preview_limit');
        parts.push(new Uint8Array(bytes));position+=bytes.length;
      },
      commit:async()=>{},
      discard:async()=>{parts.length=0}
    };
    try{
      await downloadBridgeFile({
        api:bridgeClient,deviceId,handle:item.handle,size:item.size,
        destination,signal:abort.signal
      });
      if(abort.signal.aborted||!alive())return;
      url=URL.createObjectURL(new Blob(parts,{type:item.mime}));
      message.remove();
      const view=document.createElement(item.mime==='application/pdf'?'iframe':'img');
      view.src=url;
      view.setAttribute('aria-label','Anteprima '+item.name);
      view.style.maxWidth='100%';
      view.style.maxHeight='65vh';
      if(view.tagName==='IFRAME'){view.style.width='100%';view.style.height='55vh';view.setAttribute('sandbox','');}
      panel.appendChild(view);
    }catch(error){
      if(!abort.signal.aborted)message.textContent='Anteprima non disponibile: '+(error?.message||'errore');
    }
  };
  const startDownload=async(item,deviceId,root=false)=>{
    if(activeDownload||!alive())return;
    const title=root?'Cartella condivisa':item.name;
    if(!confirm('Scaricare '+title+' nella cartella di destinazione scelta su questo telefono?'))return;
    activeDownload=true;
    cancel.hidden=false;
    controller=new AbortController();
    try{
      await destinationReady();
      setStatus('Preparazione download…');
      if(root||item.directory){
        const writer=createBridgeAndroidFolderDestination({plugin:bridgeDestination,name:title});
        const result=await downloadBridgeFolder({
          api:bridgeClient,deviceId,root:root?'root':item.handle,
          destination:writer,signal:controller.signal,
          onProgress:p=>setStatus('Scaricati '+p.completedFiles+
            ' file. '+p.path.join('/')+' · '+p.fileBytes+'/'+p.fileTotalBytes+' byte')
        });
        setStatus('Cartella scaricata: '+result.files+' file.');
      }else{
        if(item.size<0)throw Error('Dimensione del file non disponibile.');
        await fileDownload(item,deviceId);
        setStatus('File scaricato: '+item.name);
      }
    }catch(error){
      setStatus(error?.message||'Download non riuscito.');
    }finally{
      controller=null;activeDownload=false;cancel.hidden=true;
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
  async function listDevices(){
    if(!alive())return;
    const marker=++revision;
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
  async function showDevice(deviceId,label){
    const marker=++revision;
    const stack=[{handle:'root',name:label}];
    const lister=createBridgeRemoteFolderLister({api:bridgeClient,deviceId});
    const history=()=>stack.map(x=>x.name).join(' / ');
    // Session-only cache: navigating Back must not issue the same remote jobs.
    // Do not persist remote filenames or ephemeral file handles to storage.
    const folderPages=new Map();
    let navigation=0;
    async function display(offset=0){
      if(!alive()||marker!==revision)return;
      if(activeDownload){setStatus('Completa o annulla il download prima di navigare.');return;}
      const view=++navigation;
      const current=stack[stack.length-1];
      const key=current.handle+'|'+offset;
      if(offset===0)browser.replaceChildren();
      if(!folderPages.has(key))setStatus('Richiesta elenco '+history()+'…');
      try{
        const cached=folderPages.get(key);
        const page=cached??validateBridgeFolderPage(await lister({handle:current.handle,offset}));
        if(!alive()||marker!==revision||view!==navigation)return;
        if(!cached)folderPages.set(key,page);
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
            for(const key of folderPages.keys())if(key.startsWith(current.handle+'|'))folderPages.delete(key);
            void display();
          };
          create('div',undefined,browser).className='bridge-remote-entries';
        }
        const list=browser.querySelector('.bridge-remote-entries');
        for(const item of page.entries){
          const line=create('div',undefined,list);
          line.className='bridge-entry';
          const primary=create('button',(item.directory?'📁 ':'📄 ')+item.name,line);
          primary.className='bridge-entry-primary';
          primary.type='button';
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
        if(page.nextOffset!==-1){
          const more=create('button','Altri elementi',list);
          more.onclick=()=>{more.remove();void display(page.nextOffset)};
        }
        if(!page.entries.length&&offset===0)create('p','Cartella vuota.',list);
        setStatus(cached?'Elenco già caricato.':'Elenco aggiornato. Puoi aprire o scaricare file e cartelle.');
      }catch(error){
        setStatus('Elenco non disponibile: '+(error?.message||'errore remoto'));
      }
    }
    await display();
  }
  refresh.onclick=()=>void listDevices();
  void listDevices();
  return ()=>{
    disposed=true;revision++;
    controller?.abort();
  };
}
