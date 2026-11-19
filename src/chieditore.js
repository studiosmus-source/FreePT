/** Pre-account UI/state machine. Never creates a Supabase session or profile. */
export function createChieditore({files,notifications,native,tx,clock=Date.now}={}){
 let step='files',verified=false,pairCode=null,started=false,batteryOpened=false;
 const began=clock(),stages=[];
 const record=(stage,state)=>stages.push({stage,state,elapsedMs:Math.max(0,Math.min(86400000,clock()-began))});
 const snapshot=()=>({step,verified,pairCode,stages:stages.map(x=>({...x}))});
 let pending=null,disposed=false;
 async function advance(){
  if(disposed)throw Error('diagnostic_closed');
  if(step==='files'){
   let p=await files.status();if(!p?.granted)await files.requestPermission();
   p=await files.status(); // Re-read actual permission after returning from Settings.
   record(step,p?.granted?'granted':'denied');
   if(!p?.granted)return {...snapshot(),state:'denied'};
   step='notifications';return {...snapshot(),state:'granted'};
  }
  if(step==='notifications'){
   let p=await notifications.checkPermissions();
   if(p?.receive==='prompt'||p?.receive==='prompt-with-rationale')await notifications.requestPermissions();
   else if(p?.receive!=='granted')await native.notificationSettings();
   p=await notifications.checkPermissions();
   record(step,p?.receive==='granted'?'granted':'denied');
   // No push register/token/DB access before personal approval.
   if(p?.receive!=='granted')return {...snapshot(),state:'denied'};
   step='battery';return {...snapshot(),state:'granted'};
  }
  if(step==='battery'){
   let b=await native.battery();
   if(!b?.unrestricted&&!batteryOpened){batteryOpened=true;await native.batterySettings();b=await native.battery();}
   record(step,b?.unrestricted?'granted':'restricted');
   record('battery','unverifiable'); // Vendor restrictions are not queryable.
   step='bridge';return {...snapshot(),state:b?.unrestricted?'granted':'restricted'};
  }
  if(step==='bridge'){
   if(!started){
    const r=await native.begin();pairCode=r?.pairCode||null;
    if(typeof pairCode!=='string'||!/^[0-9a-f]{12}$/.test(pairCode))throw Error('diagnostic_invalid_response');
    if(disposed)throw Error('diagnostic_closed');
    started=true;await tx.start();
    if(disposed){await tx.stop();throw Error('diagnostic_closed');}
   }
   const r=await native.status();
   // A foreground-service flag is never an acceptance criterion.
   if(disposed)throw Error('diagnostic_closed');
   verified=r?.verified===true;
   record(step,verified?'verified':'pending');
   return {...snapshot(),state:verified?'verified':'pending'};
  }
  throw Error('diagnostic_invalid_step');
 }
 return Object.freeze({snapshot,
  async next(){
   if(pending)return pending;
   pending=advance().catch(error=>{record(step,'error');if(step==='bridge')started=false;throw error;}).finally(()=>{pending=null;});return pending;
  },
  async canRegister(){if(!verified||disposed)return false;try{const r=await native.status();verified=r?.verified===true;return !disposed&&verified;}catch{verified=false;return false;}},
  async report(){return native.shareReport({stages:stages.map(x=>({...x}))});},
  async localReport(){return native.diagnosticReport({stages:stages.map(x=>({...x}))});},
  async dispose(){disposed=true;if(!verified){try{await tx.stop();}catch{}}}
 });
}
export function mountChieditore({host,heading='',controller,onVerified,onExit,onAdminEntry}={}){
 host.innerHTML='<div class="shell">'+heading+'<main class="panel"><h2>Preparazione del telefono</h2><p id="diagnosticProgress" class="small"></p><h3 id="diagnosticName"></h3><p id="diagnosticHelp"></p><p id="diagnosticState" role="status" aria-live="polite"></p><div class="form"><button id="diagnosticNext" type="button">Continua</button><button id="diagnosticReport" type="button">Visualizza rapporto</button><button id="diagnosticShare" type="button">Condividi file JSON</button><pre id="diagnosticOutput" tabindex="0" hidden></pre><button id="diagnosticClose" type="button">Chiudi diagnostica</button></div></main></div>';
 const name=host.querySelector('#diagnosticName'),status=host.querySelector('#diagnosticState'),next=host.querySelector('#diagnosticNext'),report=host.querySelector('#diagnosticReport');
 const help=host.querySelector('#diagnosticHelp'),progress=host.querySelector('#diagnosticProgress'),close=host.querySelector('#diagnosticClose');
 const output=host.querySelector('#diagnosticOutput'),share=host.querySelector('#diagnosticShare');
 let active=true,busy=false,timer=null,polls=0;
 const order=['files','notifications','battery','bridge'];
 const names={files:'Accesso ai file',notifications:'Notifiche',battery:'Batteria',bridge:'Collegamento Bridge'};
 const explanation={
  files:'Concedi l’accesso richiesto da Android solo se vuoi attivare la condivisione dei file tramite Bridge.',
  notifications:'Autorizza le notifiche per ricevere gli avvisi e mantenere visibile il servizio.',
  battery:'Controlla le impostazioni della batteria. Alcune limitazioni del telefono non possono essere verificate automaticamente.',
  bridge:'Il telefono genera un codice: chi amministra FreePT deve inserirlo nel pannello Bridge della propria app, poi autorizzare il dispositivo. Non serve ancora il tuo nome o numero.'
 };
 const stopPolling=()=>{clearTimeout(timer);timer=null;};
 const draw=(state='Da verificare')=>{
  const s=controller.snapshot();name.textContent=names[s.step]||'Verifica';
  progress.textContent='Passaggio '+(order.indexOf(s.step)+1)+' di 4';
  help.textContent=explanation[s.step]||'';
  const code=s.pairCode&&!s.verified?s.pairCode.toUpperCase():null;
  status.textContent=state+(code?' — Codice da comunicare all’amministratore: '+code:'');
  next.hidden=!!s.verified;
  next.textContent=s.step==='bridge'?'Riprova verifica':'Continua';
  close.textContent=s.verified?'Concludi e prosegui':'Chiudi diagnostica';
 };
 const later=()=>{if(active&&!busy&&controller.snapshot().step==='bridge'&&polls<12)timer=setTimeout(run,5000);};
 async function run(){
  if(!active||busy)return;busy=true;next.disabled=true;stopPolling();
  try{
   const previous=controller.snapshot().step;
   const r=await controller.next();if(!active)return;
   draw(r.step!==previous?'Da verificare':({denied:'Permesso non concesso: controlla le impostazioni e riprova.',granted:'Verificato',restricted:'Limitazione batteria rilevata; ColorOS non è sempre verificabile.',pending:'In attesa dell’autorizzazione amministratore o del trasferimento diagnostico.',verified:'Verificato'})[r.state]||'Stato da verificare');
   if(previous==='bridge'&&r.step==='bridge'&&!r.verified){
    polls+=1;
    if(polls>=12)status.textContent+=' Verifica automatica sospesa: premi Riprova verifica o esporta il rapporto.';
   }
  }catch{
   if(active){draw('Errore durante la verifica. Esporta il rapporto diagnostico per identificare il problema.');polls=12;}
  }finally{busy=false;if(active){next.disabled=false;if(polls>0&&polls<12)later();}}
 }
 next.onclick=()=>{if(polls>=12)polls=0;void run();};
 report.onclick=()=>void controller.localReport().then(data=>{
  if(!active)return;
  output.textContent=JSON.stringify(data,null,2);
  output.hidden=false;
  status.textContent='Rapporto diagnostico visualizzato qui sotto. Puoi selezionare e copiare il testo.';
 }).catch(()=>{if(active)status.textContent='Rapporto nativo non disponibile (diagnostic_unavailable).';});
 share.onclick=()=>void controller.report().catch(()=>{
  if(active){status.textContent='Condivisione Android non disponibile. Premi Visualizza rapporto per leggere il JSON qui.';}
 });
 close.onclick=async()=>{
  if(busy||!active)return;busy=true;next.disabled=true;stopPolling();
  try{
   const ready=await controller.canRegister();if(!active)return;
   if(ready){active=false;await controller.dispose();onVerified();}
   else{active=false;await controller.dispose();await onExit();}
  }catch{
   if(active){busy=false;next.disabled=false;draw('Chiusura non riuscita: riprova oppure esporta il rapporto.');}
  }
 };
 if(onAdminEntry)onAdminEntry();draw();
 return ()=>{active=false;stopPolling();void controller.dispose();};
}
