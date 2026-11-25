/**
 * One administrator download at a time, owned by the app rather than by the
 * chat's file panel: leaving the panel or opening another chat no longer
 * aborts it. A fixed banner shows progress, "Riprendi" after a network
 * interruption and "Interrompi".
 *
 * Limits (stated, not hidden): this runs in the app's WebView. Android may
 * suspend or stop it when the app stays in background for long; there is no
 * native foreground service or system notification for admin downloads yet.
 * Completed files of a folder are preserved by the existing receiver.
 */
const MESSAGES={
  bridge_transfer_cancelled:'Download interrotto.',
  bridge_backend_unavailable:'Server Bridge non disponibile in questo momento. Riprova tra poco.',
  bridge_request_throttled:'Server Bridge occupato (troppe richieste). Riprova tra poco.',
  bridge_network_unavailable:'Connessione assente o instabile.',
  bridge_http_timeout:'Il server non ha risposto in tempo.',
  bridge_auth_required:'Sessione o autorizzazione non più valida. Accedi di nuovo.',
  bridge_download_timeout:'Il telefono remoto non ha risposto in tempo.',
  bridge_download_job_cancelled:'Il telefono remoto ha annullato la lettura.',
  bridge_remote_browse_timeout:'Il telefono remoto non ha risposto entro il limite di attesa.',
  bridge_remote_browse_expired:'Richiesta scaduta: il telefono remoto non l’ha ritirata.',
  bridge_remote_item_changed:'Il file o la cartella è cambiato sul telefono remoto. Premi Aggiorna e riprova.',
  bridge_transfer_busy:'C’è già un download in corso. Attendi o interrompilo.'
};
export function describeBridgeError(error,fallback='Operazione non riuscita.'){
  const code=error?.message;
  if(typeof code!=='string'||!code)return fallback;
  if(MESSAGES[code])return MESSAGES[code];
  // Never show raw technical codes; Italian messages are passed through.
  return /^bridge_[a-z0-9_]+$/.test(code)?fallback+' ('+code+')':code;
}

export function createBridgeTransferManager({doc=globalThis.document,keepFinishedMs=12000}={}){
  let current=null,banner=null,text=null,retry=null,stop=null,close=null,hideTimer=null;
  const listeners=new Set();
  const notify=()=>{for(const fn of [...listeners]){try{fn(current!==null);}catch{/* ignore */}}};
  const ensureBanner=()=>{
    if(banner?.isConnected||!doc?.body)return;
    banner=doc.createElement('section');
    banner.className='bridge-transfer-banner';
    banner.setAttribute('role','status');banner.setAttribute('aria-live','polite');
    text=doc.createElement('p');text.className='bridge-transfer-banner-text';
    const actions=doc.createElement('div');actions.className='bridge-transfer-banner-actions';
    retry=doc.createElement('button');retry.type='button';retry.textContent='Riprendi';retry.hidden=true;
    stop=doc.createElement('button');stop.type='button';stop.textContent='Interrompi';
    close=doc.createElement('button');close.type='button';close.textContent='Chiudi';close.hidden=true;
    stop.onclick=()=>manager.cancel();
    close.onclick=()=>{banner?.remove();};
    actions.append(retry,stop,close);banner.append(text,actions);doc.body.append(banner);
  };
  const say=value=>{ensureBanner();if(text)text.textContent=value;};
  const manager={
    active:()=>current!==null,
    label:()=>current?.label??null,
    onChange(fn){listeners.add(fn);return ()=>listeners.delete(fn);},
    start({label,run}){
      if(current)return Promise.reject(Error('bridge_transfer_busy'));
      if(typeof run!=='function'||typeof label!=='string')
        return Promise.reject(Error('bridge_transfer_invalid'));
      clearTimeout(hideTimer);
      const controller=new AbortController();
      current={label,controller};
      ensureBanner();
      if(stop)stop.hidden=false;
      if(close)close.hidden=true;
      say(label+': avvio…');
      notify();
      const signal=controller.signal;
      const context={
        signal,
        status:value=>{if(current?.controller===controller)say(label+' · '+value);},
        askRetry:message=>new Promise(resolve=>{
          if(signal.aborted){resolve(false);return;}
          say(label+' · '+message);
          const settle=value=>{
            retry.hidden=true;retry.onclick=null;
            signal.removeEventListener('abort',aborted);resolve(value);
          };
          const aborted=()=>settle(false);
          retry.hidden=false;retry.onclick=()=>settle(true);
          signal.addEventListener('abort',aborted,{once:true});
        })
      };
      return (async()=>{
        let outcome;
        try{outcome=await run(context)||'completato.';}
        catch(error){outcome=describeBridgeError(error,'Download non riuscito.');}
        finally{
          current=null;
          if(retry){retry.hidden=true;retry.onclick=null;}
          if(stop)stop.hidden=true;
          if(close)close.hidden=false;
          notify();
        }
        say(label+' · '+outcome);
        hideTimer=setTimeout(()=>{if(!current)banner?.remove();},keepFinishedMs);
        return outcome;
      })();
    },
    cancel(){
      if(!current)return;
      current.controller.abort();
      say(current.label+' · Interruzione richiesta…');
    },
    /** Logout / loss of administrator session: stop and remove the banner. */
    dispose(){
      current?.controller.abort();
      clearTimeout(hideTimer);
      banner?.remove();banner=null;
    }
  };
  return manager;
}
