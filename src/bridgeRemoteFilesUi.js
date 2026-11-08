/**
 * Isolated Android Bridge file browser. All operations are grant-gated by the
 * HTTPS backend; destination writes are confined to an owner-chosen SAF tree.
 * This UI never embeds device credentials, raw paths or server-role keys.
 */
import {createBridgeRemoteFolderLister} from './bridgeBrowseClient.js';
import {downloadBridgeFolder} from './bridgeFolderDownloadClient.js';
import {downloadBridgeFile} from './bridgeDownloadClient.js';
import {createBridgeAndroidFolderDestination} from './bridgeAndroidDestination.js';
import {validateBridgeFolderPage} from './bridgeFileProtocol.js';

function create(node,label,parent){
  const el=document.createElement(node);
  if(label!==undefined)el.textContent=label;
  if(parent)parent.appendChild(el);
  return el;
}

export function renderBridgeRemoteFiles({
  host,db,bridgeClient,bridgeDestination,adminId,isAuthorized
}={}){
  if(!host||typeof db?.from!=='function'||typeof isAuthorized!=='function')
    throw Error('bridge_remote_ui_invalid_options');
  host.replaceChildren();
  let disposed=false;
  let revision=0;
  let controller=null;
  let activeDownload=false;
  const alive=()=>!disposed&&host.isConnected&&isAuthorized();
  const notice=create('p','Seleziona un dispositivo autorizzato. Il telefono proprietario deve avere Bridge attivo e rispondere alle richieste.',host);
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
    const name='FreePT - '+item.name;
    const writer=createBridgeAndroidFolderDestination({plugin:bridgeDestination,name});
    await writer.begin();
    try{
      const file=await writer.openFile([item.name],{size:item.size,mime:item.mime});
      await downloadBridgeFile({
        api:bridgeClient,deviceId,handle:item.handle,size:item.size,
        destination:file,signal:controller.signal,
        onProgress:p=>setStatus('Download '+item.name+': '+p.receivedBytes+' / '+p.totalBytes+' byte')
      });
      if(controller.signal.aborted)throw Error('bridge_transfer_cancelled');
      await writer.commit();
    }catch(error){
      await writer.discard();
      throw error;
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
      const {data,error}=await db.from('bridge_grants')
        .select('device_id,bridge_devices!inner(id,label,bridge_enabled)')
        .eq('receiver_id',adminId).is('revoked_at',null).limit(100);
      if(error)throw error;
      if(!alive()||marker!==revision)return;
      const allowed=(data||[]).map(row=>row.bridge_devices)
        .filter(device=>device&&device.bridge_enabled===true);
      if(!allowed.length){
        setStatus('Nessun dispositivo condiviso con questo amministratore.');
        return;
      }
      create('h3','Telefoni condivisi con te',devices);
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
    async function display(offset=0){
      if(!alive()||marker!==revision)return;
      if(activeDownload){setStatus('Completa o annulla il download prima di navigare.');return;}
      if(offset===0)browser.replaceChildren();
      setStatus('Richiesta elenco '+history()+'…');
      try{
        const current=stack[stack.length-1];
        const page=validateBridgeFolderPage(await lister({handle:current.handle,offset}));
        if(!alive()||marker!==revision)return;
        if(offset===0){
          create('h3',history(),browser);
          if(stack.length>1){
            const back=create('button','‹ Indietro',browser);
            back.onclick=()=>{stack.pop();void display()};
          }
          const download=create('button','Scarica questa cartella completa',browser);
          download.onclick=()=>void startDownload(
            {name:current.name,handle:current.handle,directory:true},deviceId,
            current.handle==='root');
          create('div',undefined,browser).className='bridge-remote-entries';
        }
        const list=browser.querySelector('.bridge-remote-entries');
        for(const item of page.entries){
          const line=create('div',undefined,list);
          create('span',(item.directory?'📁 ':'📄 ')+item.name,line);
          if(item.directory){
            const open=create('button','Apri',line);
            open.onclick=()=>{stack.push({handle:item.handle,name:item.name});void display()};
          }
          const download=create('button',item.directory?'Scarica cartella':'Scarica file',line);
          download.onclick=()=>void startDownload(item,deviceId);
        }
        if(page.nextOffset!==-1){
          const more=create('button','Altri elementi',list);
          more.onclick=()=>{more.remove();void display(page.nextOffset)};
        }
        if(!page.entries.length&&offset===0)create('p','Cartella vuota.',list);
        setStatus('Elenco aggiornato. Puoi aprire o scaricare file e cartelle.');
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
