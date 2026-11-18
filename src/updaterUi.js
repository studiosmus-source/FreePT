/**
 * Minimal, non-intrusive update banner shown to every FreePT user (admin and
 * normal) once a newer APK is offered by the locked updater endpoint.
 *
 * It is deliberately quiet: one line, one «Avvia» button. The actual install
 * is driven by the native plugin and Android's own mandatory confirmations.
 * This module touches only its own DOM node and never blocks the chat UI.
 */
export function mountUpdaterBanner({host,updater,escape=(s=>String(s))}={}){
  if(!host||!updater||typeof updater.check!=='function')return ()=>{};
  let node=null,busy=false,disposed=false;
  const remove=()=>{if(node){node.remove();node=null;}};
  const dispose=()=>{disposed=true;remove();};
  (async()=>{
    let update;
    try{update=await updater.check();}catch{update=null;}
    if(disposed||!update)return;
    remove();
    node=document.createElement('div');
    node.id='updateBanner';
    node.className='update-banner';
    node.setAttribute('role','status');
    node.innerHTML='<span class="update-text">Aggiornamento disponibile ('+
      escape(update.versionName)+')</span>'+
      '<button type="button" id="updateStart">Avvia</button>'+
      '<span class="update-progress" id="updateProgress"></span>';
    host.prepend(node);
    const button=node.querySelector('#updateStart');
    const progress=node.querySelector('#updateProgress');
    button.onclick=async()=>{
      if(busy)return;busy=true;button.disabled=true;
      progress.textContent='Scaricamento… 0%';
      try{
        const outcome=await updater.downloadAndInstall(update,{
          onProgress:pct=>{if(!disposed)progress.textContent='Scaricamento… '+pct+'%';}
        });
        if(disposed)return;
        if(outcome&&outcome.needsPermission){
          progress.textContent='Consenti l’installazione a FreePT, poi premi di nuovo Avvia.';
          button.disabled=false;busy=false;return;
        }
        // Android's installer has taken over; keep a simple, calm instruction.
        progress.textContent='Conferma l’installazione nella finestra di Android.';
      }catch{
        if(disposed)return;
        progress.textContent='Aggiornamento non riuscito. Riprova più tardi.';
        button.disabled=false;busy=false;
      }
    };
  })();
  return dispose;
}
