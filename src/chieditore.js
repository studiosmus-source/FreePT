/** Pre-account UI/state machine. Never creates a Supabase session or profile. */
export function createChieditore({files,notifications,native,tx,clock=Date.now}={}){
 let step='files',verified=false,pairCode=null,started=false,batteryOpened=false,prepared=false;
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
    started=true;
   }
   // A signed HTTPS enrollment prepares Bridge; approval and transfer follow later.
   const r=await native.localStatus();
   if(disposed||!r?.initialized)throw Error('bridge_enrollment_unavailable');
   await tx.start();
   prepared=true;
   step='ready';record('bridge','pending');
   return {...snapshot(),state:'prepared'};
  }
  throw Error('diagnostic_invalid_step');
 }
 return Object.freeze({snapshot,
  async next(){
   if(pending)return pending;
   pending=advance().catch(error=>{record(step,'error');if(step==='bridge')started=false;throw error;}).finally(()=>{pending=null;});return pending;
  },
  async canRegister(){if(disposed||!started)return false;try{const r=await native.localStatus();return !disposed&&r?.initialized===true;}catch{return false;}},
  async report(){return native.shareReport({stages:stages.map(x=>({...x}))});},
  async localReport(){return native.diagnosticReport({stages:stages.map(x=>({...x}))});},
  async dispose(){disposed=true;if(!prepared){try{await tx.stop();}catch{}}}
 });
}
/** Simple first-run consent. Never disclose device pairing secrets. */
export function mountChieditore({host,heading='',controller,onVerified,onExit,onAdminEntry}={}){
 host.innerHTML='<div class="shell">'+heading+'<main class="panel">'+
 '<button id="setupNext" type="button">Avvia configurazione</button></main></div>';
 const button=host.querySelector('#setupNext');
 let active=true,busy=false;
 async function proceed(){
  if(!active||busy)return;busy=true;button.disabled=true;
  try{
   for(let n=0;n<4&&active;n++){
    const stage=controller.snapshot().step;
    if(stage==='ready')break;
    const r=await controller.next();
    if(!active)return;
    if(r.state==='denied')return;
   }
   if(!active)return;
   if(await controller.canRegister()){
    active=false;await controller.dispose();onVerified();
   }
  }catch{/* Keep the single configuration action available for retry. */}
  finally{busy=false;if(active){button.disabled=false;button.textContent='Avvia configurazione';}}
 }
 button.onclick=()=>void proceed();
 if(onAdminEntry)onAdminEntry();
 return ()=>{active=false;void controller.dispose();};
}
