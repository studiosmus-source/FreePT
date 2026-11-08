import {CapacitorHttp} from '@capacitor/core';
import {createOriginalTxRx} from './originalTxRx.js';
import {createBridgeAndroidSingleFileWriter} from './bridgeAndroidDestination.js';

/** Admin-only UI. Never display or persist the relay secrets. */
export function renderOriginalTxRx({host,destination,isAuthorized}={}){
  if(!host||typeof isAuthorized!=='function')throw Error('tx_rx_ui_invalid');
  const client=createOriginalTxRx({request:options=>CapacitorHttp.request(options)});
  let disposed=false,serial=0,busy=false,folder='',pageOffset=0;
  const active=()=>!disposed&&host.isConnected&&isAuthorized();
  const make=(tag,label,parent=host)=>{
    const element=document.createElement(tag);
    if(label!==undefined)element.textContent=label;
    parent.appendChild(element);return element;
  };
  host.replaceChildren();
  const hint=make('p','TX originale · Inserisci le chiavi del relay per collegarti come RX.');
  const rx=make('input');rx.type='password';rx.placeholder='Chiave RX';rx.autocomplete='off';
  const tx=make('input');tx.type='password';tx.placeholder='Chiave TX';tx.autocomplete='off';
  const login=make('button','Verifica chiavi e collega');
  const status=make('p','');
  status.setAttribute('role','status');
  const content=make('section');
  const message=value=>{if(active())status.textContent=value};
  async function show(path='',offset=0){
    if(!active()||busy)return;
    const revision=++serial;busy=true;message('Lettura file remoti…');
    try{
      const result=await client.list(path,offset);
      if(!active()||revision!==serial)return;
      if(offset===0){
        folder=path;pageOffset=0;content.replaceChildren();
        const back=make('button','‹ Indietro',content);
        back.disabled=!path;
        back.onclick=()=>void show(path.split('/').slice(0,-1).join('/'));
        make('h3',path||'Memoria TX',content);
      }
      for(const entry of result.entries){
        const line=make('div',undefined,content);
        const label=make('button',(entry.directory?'📁 ':'📄 ')+entry.name,line);
        label.onclick=()=>entry.directory?void show(entry.path):void download(entry);
      }
      pageOffset=offset+result.entries.length;
      if(result.hasMore&&result.entries.length){
        const next=make('button','Carica altri file',content);
        next.onclick=()=>{next.remove();void show(path,pageOffset);};
      }
      message(result.entries.length?'File disponibili.':'Cartella vuota.');
    }catch(error){message(error?.message||'TX non disponibile');}
    finally{busy=false;}
  }
  async function download(entry){
    if(!active()||busy)return;
    if(!destination){message('Download disponibile soltanto nell’APK Android.');return;}
    busy=true;
    let writer=null,completed=false;
    try{
      const chosen=await destination.getDestination();
      if(!chosen?.selected){await destination.chooseDestination();}
      const size=entry.size;
      if(!Number.isSafeInteger(size)||size<0)throw Error('tx_rx_invalid_file_size');
      writer=await createBridgeAndroidSingleFileWriter({
        plugin:destination,name:entry.name,size,mime:'application/octet-stream'
      });
      let offset=0;
      while(offset<size){
        if(!active())throw Error('tx_rx_cancelled');
        const part=await client.read(entry.path,offset);
        const binary=atob(part.base64);
        const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
        if(!bytes.length||part.nextOffset!==offset+bytes.length||
           part.totalBytes!==size)throw Error('tx_rx_invalid_chunk');
        await writer.write(bytes,offset);
        offset+=bytes.length;
        message('Download '+entry.name+': '+offset+' / '+size+' byte');
      }
      await writer.commit();completed=true;
      message('Scaricato: '+entry.name);
    }catch(error){message(error?.message||'Download non riuscito');}
    finally{if(writer&&!completed)try{await writer.discard()}catch{}busy=false;}
  }
  login.onclick=async()=>{
    if(!active()||busy)return;busy=true;login.disabled=true;
    message('Verifica collegamento…');
    try{
      await client.connect(rx.value.trim(),tx.value.trim());
      rx.value='';tx.value='';
      if(!active()){client.disconnect();return;}
      rx.remove();tx.remove();login.remove();hint.textContent='TX originale · RX collegato';
      const pending=make('button','Richieste di attivazione TX',content);
      pending.onclick=async()=>{
        if(!active()||busy)return;
        busy=true;
        try{
          const requests=await client.pending();
          content.replaceChildren();
          for(const item of requests){
            const row=make('button','Approva '+item.name+' · '+item.code,content);
            row.onclick=async()=>{
              if(!active()||busy)return;
              busy=true;
              try{await client.approve(item.id);message('TX autorizzato.');}
              catch(error){message(error.message);}
              finally{busy=false;}
            };
          }
          const back=make('button','Vai ai file',content);
          back.onclick=()=>void show();
          message(requests.length+' richieste disponibili');
        }catch(error){message(error.message);}
        finally{busy=false;}
      };
      busy=false;
      await show();
    }catch(error){message(error?.message||'Chiavi non valide');}
    finally{busy=false;if(active())login.disabled=false;}
  };
  return ()=>{disposed=true;serial++;client.disconnect();rx.value='';tx.value='';};
}
