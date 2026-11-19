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
  async dispose(){disposed=true;if(!verified){try{await tx.stop();}catch{}}}
 });
}
export function mountChieditore({host,heading='',controller,onVerified,onExit,onAdminEntry}={}){
 host.innerHTML='<div class="shell">'+heading+'<main class="panel"><h2>Chieditore</h2><p id="diagnosticName"></p><p id="diagnosticState" role="status"></p><button id="diagnosticNext" type="button">Continua</button><button id="diagnosticReport" type="button" hidden>Condividi rapporto</button><button id="diagnosticClose" type="button">Chiudi diagnostica</button></main></div>';
 const name=host.querySelector('#diagnosticName'),status=host.querySelector('#diagnosticState'),next=host.querySelector('#diagnosticNext'),report=host.querySelector('#diagnosticReport');
 let active=true,busy=false,timer=null;
 const names={files:'File',notifications:'Notifiche',battery:'Batteria',bridge:'Bridge'};
 const draw=(state='da verificare')=>{
  const s=controller.snapshot();name.textContent=names[s.step];
  status.textContent=state+(s.pairCode&&!s.verified?' · '+s.pairCode.toUpperCase():'');
  next.hidden=s.verified;
 };
 async function run(){
  if(!active||busy)return;busy=true;next.disabled=true;clearTimeout(timer);
  try{
   const previous=controller.snapshot().step;
   const r=await controller.next();if(!active)return;
   draw(r.step!==previous?'da verificare':({denied:'negato',granted:'verificato',restricted:'limitata · ColorOS: non verificabile',pending:'in attesa di autorizzazione / verifica',verified:'verificato'})[r.state]);
   if(previous==='bridge'&&r.step==='bridge'&&!r.verified)timer=setTimeout(run,3000);
  }catch{if(active){draw('errore');report.hidden=false;}}
  finally{busy=false;if(active)next.disabled=false;}
 }
 next.onclick=run;
 report.onclick=()=>void controller.report().catch(()=>{status.textContent='Rapporto non disponibile';});
 host.querySelector('#diagnosticClose').onclick=async()=>{
  if(busy||!active)return;busy=true;next.disabled=true;
  const ready=await controller.canRegister();if(!active)return;
  if(ready){
   active=false;clearTimeout(timer);await controller.dispose();onVerified();
  }else{active=false;clearTimeout(timer);await controller.dispose();await onExit();}
 };
 if(onAdminEntry)onAdminEntry();draw();
 return ()=>{active=false;clearTimeout(timer);void controller.dispose();};
}
