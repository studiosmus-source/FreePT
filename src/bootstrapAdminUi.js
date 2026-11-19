/** Admin pairing uses a code read on the physical consenting device. */
export function mountBootstrapAdmin({host,db,baseUrl,isAuthorized,fetchImpl=fetch,testNative=null,testFiles=null,testTx=null}={}){
 if(!host||!baseUrl)return;
 const box=document.createElement('section');
 box.innerHTML='<form class="form" autocomplete="off"><label>Codice dispositivo<input name="pairCode" required pattern="[0-9A-Fa-f]{12}" maxlength="12" autocomplete="off"></label><button type="submit">Autorizza dispositivo</button></form><p role="status"></p><form class="form" autocomplete="off"><label>Dispositivo da revocare<input name="deviceId" required maxlength="36"></label><button type="submit">Revoca dispositivo</button></form>';
 host.appendChild(box);
 if(testNative&&testFiles&&testTx){
  const testSection=document.createElement('section');
  testSection.className='bridge-selftest';
  testSection.innerHTML='<h3>Verifica su questo telefono</h3><p class="small">Prova il collegamento HTTPS e il trasferimento di 300.000 byte sintetici. Non legge i file personali e non registra utenti.</p><button type="button" id="bridgeSelfTest">Test Bridge</button><p id="bridgeSelfTestStatus" role="status" aria-live="polite"></p><pre id="bridgeSelfTestReport" tabindex="0" style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px" hidden></pre>';
  box.prepend(testSection);
  const button=testSection.querySelector('#bridgeSelfTest');
  const status=testSection.querySelector('#bridgeSelfTestStatus');
  const output=testSection.querySelector('#bridgeSelfTestReport');
  button.onclick=async()=>{
   if(!isAuthorized())return;
   button.disabled=true;output.hidden=true;
   let active=false,approved=false,deviceId=null,clean=false;
   const checks=[];
   const step=(name,state)=>{checks.push({name,state});if(isAuthorized())status.textContent=name+' — '+state;};
   const save=async()=>{
    let local=null;try{local=await testNative.diagnosticReport({stages:[]});}catch{}
    if(isAuthorized()){
     output.textContent=JSON.stringify({test:'FreePT TEST Bridge',checks,
       native:local?{error:local.error,serviceActive:local.serviceActive,allFiles:local.allFiles,
         bootstrapInitialized:local.bootstrapInitialized,bridgeVerifiedInProcess:local.bridgeVerifiedInProcess}:null},null,2);
     output.hidden=false;
    }
   };
   try{
    step('Permesso file Android','verifica');
    let permission=await testFiles.status();
    if(!permission?.granted){await testFiles.requestPermission();permission=await testFiles.status();}
    if(!permission?.granted)throw Error('permesso_file_non_concesso');
    step('Permesso file Android','OK');
    const state=await testNative.localStatus();
    if(state?.bound)throw Error('dispositivo_gia_associato');
    const registration=await testNative.begin();
    if(!/^[a-f0-9]{12}$/i.test(registration?.pairCode||''))throw Error('codice_test_non_valido');
    active=true;
    step('Richiesta HTTPS firmata','OK');
    const started=await testTx.start();
    if(started?.requested!==true)throw Error('avvio_servizio_rifiutato');
    step('Servizio Android','avvio richiesto');
    const accepted=await post('approve',{pairCode:registration.pairCode});
    if(accepted?.approved!==true||typeof accepted.deviceId!=='string')throw Error('approvazione_test_non_riuscita');
    approved=true;deviceId=accepted.deviceId;
    step('Autorizzazione admin HTTPS','OK');
    let done=false;
    for(let i=0;i<24;i++){
     if(!isAuthorized())throw Error('test_interrotto');
     await new Promise(resolve=>setTimeout(resolve,2500));
     let s=await testNative.status();
     if(s?.verified===true){done=true;break;}
     if(i===8)step('Trasferimento sintetico 300.000 byte','in corso');
    }
    if(!done)throw Error('trasferimento_non_verificato_60s');
    step('Trasferimento sintetico 300.000 byte e SHA256','OK');
    step('Risultato','PASS');
   }catch(error){
    // Never show bearer tokens, backend response bodies or device pairing secrets.
    const allowed=new Set(['permesso_file_non_concesso','dispositivo_gia_associato','codice_test_non_valido',
      'avvio_servizio_rifiutato','approvazione_test_non_riuscita','test_interrotto','trasferimento_non_verificato_60s']);
    step('Risultato',allowed.has(error?.message)?error.message:'ERRORE — consulta la diagnostica');
   }finally{
    try{
     if(approved&&deviceId){await post('revoke',{deviceId});clean=true;step('Revoca autorizzazione di prova','OK');}
     else if(active){await testNative.cancel();clean=true;step('Annullamento prova','OK');}
    }catch{step('Pulizia autorizzazione','da verificare — NON eliminare i dati app');}
    try{await testTx.stop();}catch{step('Arresto servizio','non confermato');}
    if(clean){try{await testNative.resetUnboundTest();step('Pulizia identità temporanea','OK');}
      catch{step('Pulizia identità temporanea','non confermata');}}
    await save();button.disabled=false;
   }
  };
 }

 const post=async(action,body)=>{
  if(!isAuthorized())throw Error('denied');
  const {data,error}=await db.auth.getSession();if(error||!data?.session?.access_token)throw Error('denied');
  if(!isAuthorized())throw Error('denied');
  const r=await fetchImpl(baseUrl+'/bridge/bootstrap/'+action,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+data.session.access_token},body:JSON.stringify(body),redirect:'error',cache:'no-store'});
  if(!r.ok)throw Error('denied');return r.json();
 };
 const forms=box.querySelectorAll('form'),message=box.querySelector('p');
 for(const [index,form] of [...forms].entries())form.onsubmit=async e=>{
  e.preventDefault();if(!isAuthorized())return;
  const b=form.querySelector('button');b.disabled=true;
  try{
   const key=index===0?'pairCode':'deviceId',value=form.querySelector('input').value.trim();
   const r=await post(index===0?'approve':'revoke',{[key]:value});
   if(isAuthorized())message.textContent=index===0?'Autorizzato · '+r.deviceId:'Revocato';
   form.reset();
  }catch{if(isAuthorized())message.textContent='Operazione non autorizzata o servizio non disponibile.';}
  finally{b.disabled=false;}
 };
}
