/**
 * Single-pass, automatic, verified APK update check and download.
 * No extra app-level "Avvia" confirmation: Android's mandatory package
 * installer and its system permissions remain in control.
 * No retries or background loops after errors/denials.
 */
export function mountUpdaterBanner({host,updater,escape=(s=>String(s))}={}){
  if(!host||!updater||typeof updater.check!=='function')return ()=>{};
  let node=null,disposed=false;
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
    const label=document.createElement('span');
    label.className='update-text';
    label.textContent='Aggiornamento disponibile ('+update.versionName+')';
    const progress=document.createElement('span');
    progress.className='update-progress';
    progress.id='updateProgress';
    progress.textContent='Scaricamento automatico… 0%';
    node.append(label,progress);
    host.prepend(node);
    try{
      const outcome=await updater.downloadAndInstall(update,{
        onProgress:pct=>{if(!disposed)progress.textContent='Scaricamento automatico… '+pct+'%';}
      });
      if(disposed)return;
      if(outcome?.needsPermission){
        progress.textContent='Android richiede l’autorizzazione per installare gli aggiornamenti. Riapri FreePT dopo averla concessa.';
        return;
      }
      // Installation still requires the OS confirmation on standard Android devices.
      progress.textContent='Completa l’installazione nella schermata di Android.';
    }catch{
      if(!disposed)progress.textContent='Aggiornamento non riuscito. Riprovare all’apertura successiva.';
    }
  })();
  return dispose;
}
