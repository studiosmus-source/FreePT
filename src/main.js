import {createChieditore,mountChieditore} from './chieditore.js';
import {createBridgeAutoSetup} from './bridgeAutoSetup.js';
import {mountBootstrapAdmin} from './bootstrapAdminUi.js';
import { createClient } from '@supabase/supabase-js';
import './style.css';
import './designSystem.css';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import {createPushRegistration} from './pushRegistration.js';
import {mountImportantAlertComposer,renderImportantAlert} from './importantAlerts.js';
import {installWindowsBridgeEnrollment} from './windowsBridgeEnrollment.js';
import {obtainRequestUser} from './staleSessionRecovery.js';
import {isWindowsFreePT,normalizedWindowsEmail} from './windowsRegistration.js';
import * as tus from 'tus-js-client';
import {createBridgeAdminClient} from './bridgeAdminClient.js';
import {createBridgeOwnerClient} from './bridgeOwnerClient.js';
import {createBridgeOwnerControls} from './bridgeOwnerControls.js';
import {renderBridgeRemoteFiles} from './bridgeRemoteFilesUi.js';
import {renderOriginalTxRx} from './originalTxRxUi.js';
import {getFreePtSupabaseConfig} from './supabaseConfig.js';
import {resolveBridgeRuntimeConfig} from './bridgeRuntimeConfig.js';
import {sendAdminEmailCode,verifyAdminEmailCode,adminOtpFailureMessage} from './adminOtpAuth.js';
import {filterAdminPeople} from './adminPeopleFilter.js';
import {validateBridgeFolderPage,validateBridgeReadRequest,validateBridgeFileChunk} from './bridgeFileProtocol.js';
import {createUpdaterClient} from './updaterClient.js';
import {mountUpdaterBanner} from './updaterUi.js';
import {renderChatAttachment} from './chatAttachmentsUi.js';
import {createBridgeAndroidSingleFileWriter} from './bridgeAndroidDestination.js';

const config=getFreePtSupabaseConfig({
  url:import.meta.env.VITE_SUPABASE_URL,
  key:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  isolated:import.meta.env.VITE_BRIDGE_ISOLATED_BUILD==='true'
});
const db = createClient(config.url, config.key, { auth: { persistSession: true, autoRefreshToken: true } });
const bridgeRuntime=resolveBridgeRuntimeConfig({
  isolated:import.meta.env.VITE_BRIDGE_ISOLATED_BUILD==='true',
  production:import.meta.env.VITE_BRIDGE_PRODUCTION_BUILD==='true',
  testApiUrl:import.meta.env.VITE_BRIDGE_TEST_API_URL,
  productionApiUrl:import.meta.env.VITE_BRIDGE_API_URL
});
const bridgeFiles = Capacitor.isNativePlatform() && bridgeRuntime.enabled
  ? registerPlugin('BridgeFiles') : null;
const bridgeAllFiles = bridgeFiles ? registerPlugin('BridgeAllFiles') : null;
const bridgeTxControl = bridgeFiles ? registerPlugin('BridgeTxControl') : null;
const bridgeCredentials = bridgeFiles ? registerPlugin('BridgeCredentials') : null;
const bridgeDestination = bridgeFiles ? registerPlugin('BridgeDestination') : null;
const bridgeRxKeys = bridgeFiles ? registerPlugin('BridgeRxKeys') : null;
const bootstrapEnabled=import.meta.env.VITE_BRIDGE_ISOLATED_BUILD==='true'&&import.meta.env.VITE_BRIDGE_BOOTSTRAP_ENABLED==='true';
const bridgeBootstrap=bootstrapEnabled&&bridgeFiles?registerPlugin('BridgeBootstrap'):null;
let diagnosticCleanup=null;
let diagnosticPassed=false;
function diagnosticScreen(complete=()=>requestScreen()){
  if(diagnosticCleanup)diagnosticCleanup();
  const controller=createChieditore({files:bridgeAllFiles,notifications:PushNotifications,native:bridgeBootstrap,tx:bridgeTxControl});
  diagnosticCleanup=mountChieditore({host:el,heading:heading('FreePT'),controller,
    onVerified:()=>{diagnosticPassed=true;diagnosticCleanup=null;complete();},
    onExit:()=>bridgeBootstrap.close(),onAdminEntry:bindConcealedAdminEntry});
}
let bridgeClaimBusy=false;
async function bindBootstrapAfterApproval(){
 if(bridgeClaimBusy||!bridgeAutoSetup||profile?.role!=='user'||profile?.status!=='approved')return;
 bridgeClaimBusy=true;
 try{await bridgeAutoSetup.run();}
 catch{/* Retry at resume/poll; Bridge setup must not block chat. */}
 finally{bridgeClaimBusy=false;}
}

const freeptAdminShare = Capacitor.isNativePlatform() ? registerPlugin('FreePTAdminShare') : null;
// Full-APK self-updater (native). Endpoint is locked in the APK; JS cannot set it.
const freeptUpdater = Capacitor.isNativePlatform() ? registerPlugin('FreePTUpdater') : null;
const bridgeOwnerControls = bridgeCredentials ? createBridgeOwnerControls({db,auth:db.auth,credentials:bridgeCredentials}) : null;
const bridgeOwnerClient=bridgeCredentials ? createBridgeOwnerClient({
  baseUrl:bridgeRuntime.baseUrl,
  auth:db.auth,credentials:bridgeCredentials
}) : null;
const bridgeAutoSetup=bridgeBootstrap&&bridgeOwnerClient?createBridgeAutoSetup({
 native:bridgeBootstrap,files:bridgeAllFiles,tx:bridgeTxControl,
 owner:bridgeOwnerClient,controls:bridgeOwnerControls,
 getUser:()=>me&&profile?{id:me.id,role:profile.role,status:profile.status}:null
}):null;
// No production fallback. Only an explicitly configured HTTPS test backend.
const bridgeClient=createBridgeAdminClient({
  baseUrl:bridgeRuntime.baseUrl,auth:db.auth,
  // Staging-only authenticated FCM nudge. The Edge Function checks the admin,
  // the receiver grant and the queued job before contacting the remote device.
  wakeQueuedJob:import.meta.env.VITE_BRIDGE_ISOLATED_BUILD==='true'
    ? jobId=>db.functions.invoke('freept-bridge-wake',{body:{jobId}})
    : null
});
// Session-only metadata for jobs already submitted; never persist credentials.
const bridgePendingJobs=new Map();
let bridgePendingOwnerId=null;
let bridgeTxStartupInProgress=false;
async function startProvisionedTxWhenAllowed(){
  if(bridgeTxStartupInProgress||!bridgeTxControl||!bridgeOwnerControls||
     profile?.status!=='approved'||profile?.role!=='user'||!me?.id)return;
  bridgeTxStartupInProgress=true;
  const owner=me.id;
  try{
    const [state,device,permission]=await Promise.all([
      bridgeTxControl.status(),bridgeCredentials.status(),bridgeAllFiles.status()
    ]);
    if(me?.id!==owner||profile?.status!=='approved'||state?.paused||
       state?.running||!state?.configured||!permission?.granted||
       !device?.provisioned)return;
    const [setting,grants]=await Promise.all([
      bridgeOwnerControls.device(device.deviceId),
      bridgeOwnerControls.recipients(device.deviceId)
    ]);
    if(me?.id===owner&&setting?.enabled&&grants.some(x=>x.active))
      await bridgeTxControl.start();
  }catch{
    // Failed closed on expired login, missing staging backend or permissions.
  }finally{bridgeTxStartupInProgress=false;}
}
const el = document.getElementById('app');
// Both native APK identities register push only after Firebase configuration is installed.
const pushRegistration=Capacitor.isNativePlatform()?createPushRegistration({
  plugin:PushNotifications,db,
  getApprovedUser:()=>profile?.status==='approved'&&me?me:null,
  onMessage:()=>{
    if(profile?.role==='admin'&&!adminUnlocked)return;
    if(profile?.role==='admin')void listPeople().then(renderPeople).catch(()=>{});
    else if(selected)void showMessages(false).catch(()=>{});
    void checkImportantAlerts().catch(()=>{});
  }
}):null;
let me = null, profile = null, people = [], selected = null, messages = [], sub = null, busy = false;
installWindowsBridgeEnrollment({auth:db.auth,getIdentity:()=>me&&profile?{id:me.id,role:profile.role,status:profile.status}:null});
let messageRequest = 0;
let fetchingMessages = false;
let adminUnlocked = false;
let adminUnlocking = false;
let awaySince = 0;
let deleteMigrationReady = true;
let adminPeopleQuery = '';
let adminPeopleStatus = 'all';
let chatFilesCleanup=null;
function bridgeTransferActive(){
  return document.querySelector('#chatRemoteFilesPanel .bridge-files-content')?.dataset.bridgeBusy==='true';
}
function guardBridgeNavigation(){
  if(!bridgeTransferActive())return false;
  const note=document.querySelector('#chatRemoteFilesPanel p[role="status"]');
  if(note)note.textContent='Trasferimento o anteprima in corso. Usa Interrompi download o la X prima di uscire.';
  return true;
}
let filePickerActive = false;
let filePickerReturned = false;
let filePickerClearTimer = null;
function onFilePickerClick(){
  filePickerActive=true;
  filePickerReturned=false;
  if(filePickerClearTimer)clearTimeout(filePickerClearTimer);
}
function finishFilePicker(){
  filePickerActive=false;
  filePickerReturned=false;
  if(filePickerClearTimer){clearTimeout(filePickerClearTimer);filePickerClearTimer=null}
}
function fileChanged(event){
  const input=event.currentTarget;
  const label=input.closest('form')?.querySelector('[data-file-name]');
  if(label)label.textContent=input.files?.[0]?.name||'';
  finishFilePicker();
}
function configureFileInput(input){
  if(!input)return;
  input.addEventListener('click',onFilePickerClick);
  input.addEventListener('change',fileChanged);
  input.addEventListener('cancel',finishFilePicker);
}

async function unlockAdmin(){
  // Supabase auth + an approved admin profile are the only login gates.
  // Do not impose a device-specific biometric prompt on an authorized admin.
  adminUnlocked=!!me?.id&&!me.is_anonymous&&
    profile?.role==='admin'&&profile?.status==='approved';
  return adminUnlocked;
}

const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const friendly = e => e?.message || 'Operazione non riuscita';
function status(msg, bad=false){ const n=document.getElementById('status'); if(n){n.textContent=msg;n.className=bad?'error':'small'} }
function phoneNorm(s){ return s.replace(/[\s().-]/g,''); }

function heading(t,extra=''){return '<header class="top"><h1>'+esc(t)+'</h1>'+extra+'</header>'}
/** Concealed entry is UI discretion only: Supabase roles remain mandatory. */
function bindConcealedAdminEntry(){
  const title=el.querySelector('.top h1');
  if(!title)return;
  let timer=null;
  const stop=()=>{if(timer!==null){clearTimeout(timer);timer=null;}};
  title.addEventListener('pointerdown',event=>{
    if(event.pointerType==='mouse'&&event.button!==0)return;
    stop();timer=setTimeout(()=>{timer=null;adminScreen();},1300);
  });
  for(const type of ['pointerup','pointercancel','pointerleave'])title.addEventListener(type,stop);
  title.addEventListener('contextmenu',event=>event.preventDefault());
}


function requestScreen(denied=false){
  closeAdminOverlays();
  if(bridgeBootstrap&&!denied&&!diagnosticPassed){void bridgeBootstrap.localStatus().then(async s=>{if(s?.initialized){const p=await bridgeAllFiles.status();if(p?.granted){const t=await bridgeTxControl.status();if(!t.running&&!t.paused)await bridgeTxControl.start();}diagnosticPassed=true;requestScreen();}else diagnosticScreen();}).catch(()=>diagnosticScreen());return;}
  selected=null; messageRequest++;
  const win=isWindowsFreePT();
  el.innerHTML='<div class="shell request-shell">'+heading('FreePT')+'<main class="panel"><h2>Richiedi accesso</h2><p class="small">'+(win?'Inserisci nome e indirizzo email per chiedere accesso da Windows.':'Inserisci il tuo nome e numero di cellulare. Nessuna password e nessun SMS.')+'</p>'+

  '<form class="form" id="request"><input name="name" placeholder="Nome e cognome" maxlength="80" minlength="2" required autocomplete="name" '+(denied?'disabled':'')+'/>'+
  (win?'<input name="email" type="email" placeholder="Indirizzo email" maxlength="254" required autocomplete="email" '+(denied?'disabled':'')+'/>':'<input name="phone" type="tel" placeholder="Numero di telefono (+39...)" required autocomplete="tel" '+(denied?'disabled':'')+'/>')+
  '<section class="disclaimer" aria-label="Informativa sull’intelligenza artificiale"><h3>FreePT · L’intelligenza artificiale per tutti</h3><p><strong>La potenza di ChatGPT e Claude senza dover sottoscrivere un abbonamento personale.</strong></p><p>Con FreePT puoi fare liberamente domande, inviare richieste, foto e documenti e ricevere risposte elaborate attraverso ChatGPT e Claude. Nessun account personale presso questi servizi è necessario.</p><p class="disclaimer-promise"><strong>SENZA LIMITI*<br>SENZA CENSURA*</strong></p><p class="disclaimer-note">* Salvo particolari condizioni legate alla disponibilità del servizio e alla possibilità di elaborare determinate richieste.</p><p>FreePT è un servizio indipendente, non affiliato a OpenAI o Anthropic.</p><label class="consent"><input name="disclaimer" type="checkbox" required><span>Dichiaro di aver letto e accettato quanto sopra.</span></label></section>'+
  '<button '+(denied?'disabled':'')+'>Invia richiesta di accesso</button></form>'+
  '<p id="status" class="'+(denied?'error':'small')+'">'+(denied?'Richiesta non approvata. Non puoi accedere alla chat.':'')+'</p>'+
  '</main></div>';
  bindConcealedAdminEntry();
  document.getElementById('request').onsubmit=async ev=>{
    ev.preventDefault();
    const form=ev.target, f=new FormData(form),name=String(f.get('name')||'').trim(),phone=win?null:phoneNorm(String(f.get('phone')||''));
    let email=null;
    if(win){try{email=normalizedWindowsEmail(f.get('email'));}catch(e){status(e.message,true);return;}}
    if(name.length<2){status('Inserisci nome e cognome',true);return}
    if(!win&&!/^\+[1-9]\d{7,14}$/.test(phone)){status('Inserisci il numero con prefisso, ad esempio +39...',true);return}
    const button=form.querySelector('button');button.disabled=true;status('Invio richiesta in corso...');
    try {
      // Bridge device approval and synthetic transfer are independent from registration.
      const user=await obtainRequestUser(db.auth);
      const {error}=await db.from('profiles').insert(win?{id:user.id,full_name:name,email}:{id:user.id,full_name:name,phone});
      if(error) throw error;
      await boot();
    }catch(e){
      const message=friendly(e);
      // Reinstalled phone: this number already has an account. Ask to return
      // to THAT account (same chat); the person sees the usual waiting screen.
      if(!win&&(e?.code==='23505'||/profiles_phone_key|duplicate key/i.test(message))){
        try{
          const {error:returnError}=await db.functions.invoke('freept-account-return',
            {body:{action:'request',phone,name}});
          if(!returnError){
            try{localStorage.setItem(RETURN_FLAG,'1');}catch{}
            returnWaitingScreen();return;
          }
        }catch{/* falls through to the normal error message */}
      }
      status(message.includes('Anonymous sign-ins are disabled')?'Occorre abilitare gli accessi anonimi nel progetto FreePT.':message,true);
    }finally{button.disabled=false}
  };
}
async function completeAdminLogin(user){
  if(!user?.id||user.is_anonymous)throw Error('Account amministratore non valido.');
  me=user;
  try{
    await loadProfile();
    if(profile?.role!=='admin'||profile?.status!=='approved')
      throw Error('Questo account non è un amministratore autorizzato.');
  }catch(error){
    await db.auth.signOut();
    me=null;profile=null;adminUnlocked=false;
    throw error;
  }
  if(await unlockAdmin())await renderWorkspace();
}

function adminScreen(){
  if(diagnosticCleanup){diagnosticCleanup();diagnosticCleanup=null;}
  closeAdminOverlays();
  el.innerHTML='<div class="shell">'+heading('FreePT')+'<main class="panel"><h2>Accesso amministratore</h2>'+
    '<p class="small">Accedi con email e password del tuo account amministratore FreePT. La sessione resta attiva finché è valida.</p>'+
    '<form id="adminForm" class="form">'+
    '<label>Email amministratore<input type="email" name="email" autocomplete="username" placeholder="Email amministratore" required></label>'+
    '<label>Password<input type="password" name="password" autocomplete="current-password" placeholder="Password" required></label>'+
    '<button type="submit">Accedi</button></form>'+
    '<details id="adminCodeOptions"><summary>Accesso con codice email (solo se abilitato)</summary>'+
    '<p class="small">Il codice email funziona soltanto quando il metodo OTP è abilitato nel progetto Supabase.</p>'+
    '<form id="adminCodeSend" class="form"><input type="email" name="email" autocomplete="email" placeholder="Email amministratore" required>'+
    '<button type="submit">Invia codice via email</button></form>'+
    '<form id="adminCodeVerify" class="form" hidden><label for="adminOtp">Codice ricevuto via email (da 6 a 10 cifre)</label>'+
    '<input id="adminOtp" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,10}" maxlength="10" required>'+
    '<button type="submit">Accedi con codice</button></form></details>'+
    '<p id="status" class="small" role="status"></p>'+
    '<button id="backRequest" type="button">Torna alla richiesta di accesso</button></main></div>';
  document.getElementById('backRequest').onclick=()=>requestScreen();
  let pendingEmail=null;
  document.getElementById('adminCodeSend').onsubmit=async e=>{
    e.preventDefault();
    const form=e.currentTarget,button=form.querySelector('button');
    button.disabled=true;status('Invio codice in corso...');
    const requestedEmail=String(new FormData(form).get('email')||'').trim();
    try{
      pendingEmail=await sendAdminEmailCode(db.auth,requestedEmail);
      document.getElementById('adminCodeVerify').hidden=false;
      status('Se l’account è abilitato, riceverai un codice via email. Inseriscilo qui.');
    }catch(error){
      pendingEmail=null;
      status(adminOtpFailureMessage(error),true);
      if(error?.message?.startsWith('admin_code_delivery_failed:otp_disabled:')){
        document.getElementById('adminCodeOptions').open=false;
        const passwordForm=document.getElementById('adminForm');
        const emailInput=passwordForm.querySelector('input[name="email"]');
        if(!emailInput.value)emailInput.value=requestedEmail;
        passwordForm.querySelector('input[name="password"]').focus();
      }
    }finally{button.disabled=false;}
  };
  document.getElementById('adminCodeVerify').onsubmit=async e=>{
    e.preventDefault();
    if(!pendingEmail){status('Richiedi prima il codice via email.',true);return;}
    const form=e.currentTarget,button=form.querySelector('button');
    button.disabled=true;status('Verifica codice in corso...');
    try{
      const user=await verifyAdminEmailCode(db.auth,pendingEmail,new FormData(form).get('code'));
      await completeAdminLogin(user);
    }catch(error){
      status(error?.message==='admin_code_invalid'
        ?'Inserisci il codice numerico completo (da 6 a 10 cifre).'
        :'Codice non valido, scaduto o account non autorizzato.',true);
    }finally{button.disabled=false;}
  };
  document.getElementById('adminForm').onsubmit=async e=>{
    e.preventDefault();const form=e.currentTarget,button=form.querySelector('button');
    const f=new FormData(form);button.disabled=true;status('Accesso in corso...');
    try{
      const {data:{session}}=await db.auth.getSession();
      if(session?.user?.is_anonymous) await db.auth.signOut();
      const result=await db.auth.signInWithPassword({
        email:String(f.get('email')),password:String(f.get('password'))
      });
      if(result.error)throw result.error;
      await completeAdminLogin(result.data.user);
    }catch(err){status(friendly(err),true);}
    finally{button.disabled=false;}
  };
}

function waitingScreen(){
  closeAdminOverlays();
  el.innerHTML='<div class="shell">'+heading('FreePT')+'<main class="panel"><h2>Richiesta inviata</h2>'+
  '<p class="notice waiting-copy">I nostri sistemi stanno elaborando la tua richiesta di accesso… Attendere.</p>'+
  '<p class="small">Puoi lasciare l’app aperta o tornare più tardi.</p><p id="status" class="small"></p></main></div>';
}

// Return to an existing account after reinstalling: poll quietly while the
// standard waiting screen is shown; switch to the account once approved.
const RETURN_FLAG='freept_return_pending';
let returnTimer=null;
function returnWaitingScreen(){
  waitingScreen();
  if(returnTimer){clearTimeout(returnTimer);returnTimer=null;}
  const check=async()=>{
    returnTimer=null;
    try{
      const {data,error}=await db.functions.invoke('freept-account-return',{body:{action:'status'}});
      if(!error&&data?.state==='login'&&typeof data.email==='string'&&typeof data.token==='string'){
        const {error:loginError}=await db.auth.verifyOtp({email:data.email,token:data.token,type:'email'});
        if(!loginError){
          try{localStorage.removeItem(RETURN_FLAG);}catch{}
          await boot();return;
        }
      }
      if(!error&&data?.state==='denied'){
        try{localStorage.removeItem(RETURN_FLAG);}catch{}
        requestScreen(true);return;
      }
    }catch{/* offline: try again */}
    if(document.querySelector('.waiting-copy'))returnTimer=setTimeout(check,8000);
  };
  returnTimer=setTimeout(check,1500);
}
async function loadProfile(){const {data,error}=await db.from('profiles').select('id,full_name,phone,email,role,status').eq('id',me.id).maybeSingle();if(error)throw error;profile=data}
async function boot(){
  // A fresh installation has no session: this is normal, not an error.
  const {data:{session},error:sessionError}=await db.auth.getSession();
  if(sessionError){
    me=null;profile=null;requestScreen();
    // Supabase may report a missing session as an AuthSessionMissingError.
    // On a first launch this is expected, not a registration failure.
    if(sessionError.name!=='AuthSessionMissingError' &&
       sessionError.code!=='session_not_found' &&
       !/auth session missing/i.test(sessionError.message||'')){
      status(friendly(sessionError),true);
    }
    return;
  }
  if(!session){me=null;profile=null;requestScreen();return}
  const {data:{user},error}=await db.auth.getUser();
  if(error||!user){
    me=null;profile=null;requestScreen();
    if(error && error.name!=='AuthSessionMissingError' &&
       !/auth session missing/i.test(error.message||'')){
      status(friendly(error),true);
    }
    return;
  }
  me=user;selected=null;
  if(!me){profile=null;requestScreen();return}
  try{
    await loadProfile();
    if(!profile){
      let returning=false;
      try{returning=localStorage.getItem(RETURN_FLAG)==='1';}catch{}
      if(returning&&me?.is_anonymous)returnWaitingScreen();else requestScreen();
      return;
    }
    if(profile.status==='blocked'){requestScreen(true);return}
    if(profile.status==='pending'){waitingScreen();return}
    if(profile.role==='admin' && !(await unlockAdmin()))return;
    await renderWorkspace();
  }catch(e){el.innerHTML='<main class="panel"><h2>Collegamento non riuscito</h2><p>'+esc(friendly(e))+'</p><button id="retry">Riprova</button></main>';document.getElementById('retry').onclick=boot}
}

async function logout(){if(me?.id&&pushRegistration)try{await pushRegistration.clear(me.id)}catch{}closeAdminOverlays();if(profile?.role==='user'&&bridgeTxControl)try{await bridgeTxControl.stop();}catch{}adminPeopleQuery='';adminPeopleStatus='all';bridgePendingJobs.clear();bridgePendingOwnerId=null;adminUnlocked=false;if(sub){db.removeChannel(sub);sub=null}await db.auth.signOut();me=null;profile=null;selected=null;if(pushRegistration)await pushRegistration.sessionEnded();messageRequest++;requestScreen()}
async function listPeople(){
  let result=await db.from('profiles')
    .select('id,full_name,phone,email,status,role,created_at,chat_hidden_at')
    .neq('role','admin').order('created_at',{ascending:false});
  if(result.error && /chat_hidden_at/i.test(result.error.message||'')){
    // Backwards compatibility: keep normal chat functional before SQL migration.
    deleteMigrationReady=false;
    result=await db.from('profiles')
      .select('id,full_name,phone,email,status,role,created_at')
      .neq('role','admin').order('created_at',{ascending:false});
  }else if(!result.error)deleteMigrationReady=true;
  if(result.error)throw result.error;
  const users=result.data||[];
  const {data:recent,error:messagesError}=await db.from('messages')
    .select('user_id,body,file_name,created_at')
    .order('created_at',{ascending:false}).limit(300);
  if(messagesError)throw messagesError;
  const latest=new Map();
  for(const msg of recent||[])if(!latest.has(msg.user_id))latest.set(msg.user_id,msg);
  people=users.map(u=>({...u,lastMessage:latest.get(u.id)||null}))
    .filter(u=>u.status==='pending'||!u.chat_hidden_at||
      (u.lastMessage && Date.parse(u.lastMessage.created_at)>Date.parse(u.chat_hidden_at)))
    .sort((a,b)=>Number(b.status==='pending')-Number(a.status==='pending')||
      Date.parse(b.lastMessage?.created_at||b.created_at)-Date.parse(a.lastMessage?.created_at||a.created_at));
}
async function renderWorkspace(){void bindBootstrapAfterApproval();if(bridgePendingOwnerId!==me?.id){bridgePendingJobs.clear();bridgePendingOwnerId=me?.id||null;}if(profile?.role==='admin'&&!adminUnlocked&&Capacitor.isNativePlatform())return;if(sub){db.removeChannel(sub);sub=null}if(profile.role==='admin')await listPeople();else selected=me.id;renderLayout();if(selected)await showMessages();if(profile?.role==='user'){void bindBootstrapAfterApproval();void startProvisionedTxWhenAllowed();}if(Capacitor.isNativePlatform()){
  // Android notification channels cannot be upgraded in place once created.
  // Use a distinct HIGH-importance channel for personalised important alerts.
  void PushNotifications.createChannel({id:'freept-important',name:'Avvisi importanti FreePT',
    description:'Avvisi prioritari inviati dagli amministratori FreePT',importance:5,visibility:0})
    .catch(()=>{}).finally(()=>void pushRegistration?.init().catch(()=>{}));
} else void pushRegistration?.init().catch(()=>{});
void checkImportantAlerts();sub=db.channel('freept-sync').on('postgres_changes',{event:'*',schema:'public',table:'messages'},async()=>{if(selected)await showMessages(false)}).on('postgres_changes',{event:'*',schema:'public',table:'profiles'},async()=>{if(profile.role==='admin'){await listPeople();renderPeople()}}).on('postgres_changes',{event:'INSERT',schema:'public',table:'important_alerts'},()=>{void checkImportantAlerts()}).subscribe();document.addEventListener('visibilitychange',refreshOnVisible,{once:true})}
async function refreshOnVisible(){
  if(document.visibilityState==='visible'){
    if(profile?.role==='admin'&&Capacitor.isNativePlatform()&&!adminUnlocked){
      if(await unlockAdmin())await renderWorkspace();
      document.addEventListener('visibilitychange',refreshOnVisible,{once:true});
      return;
    }
    try {
      if(me && profile?.status==='pending'){
        await loadProfile();
        if(profile.status==='approved'){await renderWorkspace();return}if(profile.status==='blocked'){requestScreen(true);return}
      }
      if(me && profile?.role==='admin' && profile.status==='approved'&&!bridgeTransferActive()){
        await listPeople();
        renderPeople();
      }
      if(selected&&!bridgeTransferActive()) await showMessages(false);
      await checkImportantAlerts();
      if(profile?.role==='user'){void bindBootstrapAfterApproval();void startProvisionedTxWhenAllowed();}
    } catch(e){ status(friendly(e),true) }
  }
  document.addEventListener('visibilitychange',refreshOnVisible,{once:true});
}
function closeAdminOverlays(){
  if(typeof chatFilesCleanup==='function')chatFilesCleanup();
  chatFilesCleanup=null;
  document.getElementById('chatRemoteFilesPanel')?.remove();
  document.getElementById('adminBridgePanel')?.remove();
  document.getElementById('chatActions')?.remove();
  document.getElementById('importantAlertComposer')?.remove();
  document.getElementById('importantAlertScreen')?.remove();
  importantAlertShown=null;
  document.getElementById('ownerBridgePanel')?.remove();
}

async function loadAdminBridgeDevices(panel){
  const content=panel.querySelector('#bridgeAdminContent');
  if(!content || !panel.isConnected || profile?.role!=='admin' || !adminUnlocked)return;
  // Each tab refresh invalidates older responses so stale data cannot
  // overwrite a newer view after slow network calls.
  const ownerId=me?.id;
  if(!ownerId)return;
  const revision=panel.bridgeLoadRevision=(panel.bridgeLoadRevision||0)+1;
  content.textContent='Caricamento dispositivi autorizzati…';
  // RLS only exposes devices this approved account may read.
  // No service-role credential, device presence claim or direct mutation.
  let data,error;
  try {
    ({data,error}=await db.from('bridge_grants')
      .select('device_id,bridge_devices!inner(id,label,bridge_enabled)')
      .eq('receiver_id',ownerId).is('revoked_at',null).limit(100));
  } catch {
    error={code:'bridge_network_unavailable'};
  }
  if(!panel.isConnected || panel.bridgeLoadRevision!==revision ||
      me?.id!==ownerId || profile?.role!=='admin' || !adminUnlocked ||
      panel.querySelector('[data-bridge-view="approvals"]')?.getAttribute('aria-pressed')!=='true')return;
  if(error){
    const missing=/42P01|PGRST205|PGRST204|does not exist|schema cache/i.test(
      String(error.code||'')+' '+String(error.message||''));
    content.textContent=missing
      ?'Bridge non configurato: la migrazione dei dispositivi non è disponibile.'
      :'Impossibile leggere i dispositivi Bridge autorizzati.';
    return;
  }
  if(!data?.length){
    content.textContent='Nessun dispositivo Bridge autorizzato disponibile.';
    return;
  }
  content.innerHTML='<h3>Dispositivi autorizzati</h3>'+
    '<p>Elenco in sola lettura. La disponibilità online non è ancora verificata.</p>'+
    '<ul class="bridge-device-list">'+data.map(grant=>{
      const d=grant.bridge_devices;
      return d && typeof d==='object'
        ? '<li><strong>'+esc(d.label||'Dispositivo')+'</strong> · '+
          (d.bridge_enabled?'Bridge attivato dal proprietario':'Bridge disattivato')+
          (bridgeClient&&d.bridge_enabled
            ? ' <button type="button" data-bridge-request="'+esc(d.id)+'">Richiedi elenco</button>'
            : '')+'</li>'
        : '';
    }).join('')+'</ul>'+
    (data.length===100?'<p>Visualizzati i primi 100 dispositivi autorizzati.</p>':'');
  if(bridgeClient)content.querySelectorAll('[data-bridge-request]').forEach(button=>{
    button.onclick=()=>void requestAdminBridgeList(panel,button);
    const saved=bridgePendingJobs.get(ownerId+':'+button.dataset.bridgeRequest);
    if(saved)void requestAdminBridgeList(panel,button,saved);
  });
}

async function requestAdminBridgeList(panel,button,existingJob=null){
  if(!bridgeClient||!panel.isConnected||profile?.role!=='admin'||
     !adminUnlocked||!me||button.disabled)return;
  const deviceId=button.dataset.bridgeRequest;
  const ownerId=me.id;
  const jobKey=ownerId+':'+deviceId;
  const row=button.parentElement;
  // One pending request per visible device; no duplicate submit on rapid taps.
  row.querySelectorAll('.bridge-job-controls, .bridge-job-status').forEach(el=>el.remove());
  button.disabled=true;
  const result=document.createElement('p');
  result.setAttribute('role','status');
  result.className='bridge-job-status';
  row.appendChild(result);
  result.textContent='Invio richiesta Bridge…';
  const stillAuthorized=()=>panel.isConnected&&row.isConnected&&
    profile?.role==='admin'&&adminUnlocked&&me?.id===ownerId&&
    bridgePendingOwnerId===ownerId;
  try{
    const job=existingJob||await bridgeClient.requestList(deviceId);
    if(bridgePendingOwnerId===ownerId && me?.id===ownerId)
      bridgePendingJobs.set(jobKey,job);
    if(!stillAuthorized())return;
    const controls=document.createElement('span');
    controls.className='bridge-job-controls';
    row.appendChild(controls);
    const statusButton=document.createElement('button');
    statusButton.type='button';
    statusButton.textContent='Controlla stato';
    const cancelButton=document.createElement('button');
    cancelButton.type='button';
    cancelButton.textContent='Annulla richiesta';
    controls.append(statusButton,cancelButton);
    const catalogue=document.createElement('div');
    catalogue.className='bridge-job-catalogue';
    row.appendChild(catalogue);
    const view=document.createElement('button');
    view.type='button';
    view.textContent='Mostra elenco ricevuto';
    view.hidden=true;
    catalogue.appendChild(view);
    view.onclick=async()=>{
      if(!stillAuthorized()||view.disabled)return;
      view.disabled=true;
      try{
        const page=await bridgeClient.getFolderPage(job.jobId);
        if(!stillAuthorized())return;
        catalogue.replaceChildren();
        const summary=document.createElement('p');
        summary.textContent=page.entries.length+' elementi ricevuti:';
        catalogue.appendChild(summary);
        for(const item of page.entries){
          const entry=document.createElement('p');
          entry.textContent=(item.directory?'📁 ':'📄 ')+item.name;
          catalogue.appendChild(entry);
        }
      }catch{if(stillAuthorized())result.textContent='Elenco remoto non ancora disponibile.';}
      finally{view.disabled=false;}
    };
    let state=job.state;
    let inFlight=false;
    let message='';
    const render=()=>{
      if(!stillAuthorized())return;
      result.textContent=message||('Richiesta '+(state==='expired'?'scaduta':state)+' (ID '+job.jobId+').');
      const terminal=state==='done'||state==='cancelled'||state==='expired';
      statusButton.disabled=inFlight||terminal;
      cancelButton.disabled=inFlight||terminal;
      button.disabled=!terminal;
      view.hidden=state!=='done';
      if(terminal)bridgePendingJobs.delete(jobKey);
    };
    statusButton.onclick=async()=>{
      if(!stillAuthorized()||inFlight)return;
      inFlight=true;
      render();
      try{
        const updated=await bridgeClient.getStatus(job.jobId);
        if(!stillAuthorized())return;
        state=updated.state;
        bridgePendingJobs.set(jobKey,{...job,state});
        message='';
        render();
      }catch{
        message='Stato Bridge non disponibile.';
      }finally{
        inFlight=false;
        render();
      }
    };
    cancelButton.onclick=async()=>{
      if(!stillAuthorized()||inFlight||state==='done'||state==='cancelled')return;
      inFlight=true;
      render();
      try{
        const updated=await bridgeClient.cancel(job.jobId);
        if(!stillAuthorized())return;
        state=updated.state;
        bridgePendingJobs.set(jobKey,{...job,state});
        message='';
        render();
      }catch{
        message='Impossibile annullare: controlla lo stato.';
      }finally{
        inFlight=false;
        render();
      }
    };
    render();
  }catch{
    if(stillAuthorized())result.textContent='Richiesta Bridge non disponibile.';
  }finally{
    // Remain disabled while the job is nonterminal, until cancelled/done.
    if(!row.querySelector('.bridge-job-controls'))button.disabled=false;
  }
}

function showAdminBridge(){
  if(profile?.role!=='admin'||!adminUnlocked)return;
  document.getElementById('adminBridgePanel')?.remove();
  const panel=document.createElement('div');
  panel.id='adminBridgePanel';
  panel.className='bridge-admin-shade';
  panel.innerHTML='<section class="bridge-admin-panel" role="dialog" aria-modal="true" aria-label="Configurazione Bridge">'+
    '<header><h2>Bridge</h2><button type="button" id="closeAdminBridge">Chiudi</button></header>'+
    '<form id="bridgeKeyForm" class="form" autocomplete="off">'+
    '<label>Chiave RX<input type="password" id="bridgeRxKey" required minlength="32" maxlength="256" autocomplete="new-password"></label>'+
    '<label>Chiave TX<input type="password" id="bridgeTxKey" required minlength="32" maxlength="256" autocomplete="new-password"></label>'+
    '<button type="submit">Salva le chiavi</button></form>'+
    '<p id="bridgeKeyStatus" class="hint" role="status"></p>'+
    '<button type="button" id="bridgeKeyRemove">Cancella chiavi salvate</button>'+
    '</section>';
  document.body.appendChild(panel);
  if(bridgeBootstrap)mountBootstrapAdmin({host:panel.querySelector('section'),db,baseUrl:bridgeRuntime.baseUrl,
    testNative:bridgeBootstrap,testFiles:bridgeAllFiles,testTx:bridgeTxControl,
    isAuthorized:()=>panel.isConnected&&profile?.role==='admin'&&profile?.status==='approved'&&adminUnlocked&&!!me?.id});
  const message=panel.querySelector('#bridgeKeyStatus');
  const provider=bridgeRxKeys;
  const alive=()=>panel.isConnected&&me?.id&&profile?.role==='admin'&&adminUnlocked;
  const refresh=async()=>{
    if(!alive())return;
    if(!provider){message.textContent='Salvataggio sicuro disponibile solo su Android.';return;}
    try{
      const result=await provider.status();
      if(alive())message.textContent=result?.configured?'Chiavi salvate su questo telefono.':'Nessuna chiave salvata.';
    }catch{if(alive())message.textContent='Impossibile leggere lo stato delle chiavi.';}
  };
  panel.querySelector('#bridgeKeyForm').onsubmit=async event=>{
    event.preventDefault();
    if(!alive()||!provider)return;
    const button=event.currentTarget.querySelector('button');
    const rx=panel.querySelector('#bridgeRxKey');
    const tx=panel.querySelector('#bridgeTxKey');
    const a=rx.value.trim(),b=tx.value.trim();
    if(a.length<32||b.length<32||a===b){message.textContent='Le due chiavi devono essere diverse e di almeno 32 caratteri.';return;}
    button.disabled=true;
    try{
      // These keys are local RX settings, not the device's Supabase Bridge
      // authorization. Never reject a secure save because the legacy TX relay
      // is offline, incompatible, or a different backend.
      const saved=await provider.save({rxKey:a,txKey:b});
      if(saved?.saved!==true)throw Error('bridge_keys_not_saved');
      const verified=await provider.status();
      if(verified?.configured!==true)throw Error('bridge_keys_not_persisted');
      if(!alive())return;
      rx.value='';tx.value='';
      message.textContent='Chiavi salvate in modo sicuro sul telefono.';
    }catch(error){if(alive())message.textContent='Salvataggio non riuscito: '+friendly(error);}
    finally{button.disabled=false;}
  };
  panel.querySelector('#bridgeKeyRemove').onclick=async()=>{
    if(!alive()||!provider)return;
    try{await provider.clear();await refresh();}
    catch{if(alive())message.textContent='Impossibile cancellare le chiavi.';}
  };
  panel.querySelector('#closeAdminBridge').onclick=()=>{
    panel.querySelector('#bridgeRxKey').value='';
    panel.querySelector('#bridgeTxKey').value='';
    panel.remove();
  };
  void refresh();
}

/**
 * This is an OWNER-side Android SAF browser, not a remote file transfer.
 * The user selects exactly one tree through Android's system picker.
 */
async function showOwnerBridgeFolder(){
  if(!bridgeAllFiles||!bridgeOwnerClient||!bridgeCredentials||
     !me||profile?.status!=='approved'||profile.role!=='user')return;
  document.getElementById('ownerBridgePanel')?.remove();
  const panel=document.createElement('div');
  panel.id='ownerBridgePanel';
  panel.className='bridge-admin-shade bridge-family-shade';
  panel.innerHTML='<section class="bridge-admin-panel bridge-family-panel" role="dialog" aria-modal="true" aria-label="Attivazione">'+
    '<header><h2>Attivazione</h2><button type="button" id="closeOwnerBridge" aria-label="Chiudi">Chiudi</button></header>'+
    '<button type="button" id="bridgeFamilyStart" aria-label="Avvia collegamento">Avvia</button>'+
    '<p id="bridgeFamilyStatus" role="status" aria-live="polite"></p>'+ 
    '<p id="bridgeFamilyDiagnostic" hidden style="user-select:text;-webkit-user-select:text"></p>'+
    '</section>';
  document.body.appendChild(panel);
  const button=panel.querySelector('#bridgeFamilyStart');
  const status=panel.querySelector('#bridgeFamilyStatus');
  const currentOwner=me.id;
  let working=false;
  let activationStage='idle';
  let lastDiagnostic='';
  let diagnosticTapCount=0;
  // Support gesture: five taps on the title reveal only a safe stage/code.
  // The normal family screen has no diagnostic controls or technical labels.
  panel.querySelector('h2').onclick=()=>{
    diagnosticTapCount+=1;
    if(diagnosticTapCount<5)return;
    diagnosticTapCount=0;
    if(!lastDiagnostic)return;
    const out=panel.querySelector('#bridgeFamilyDiagnostic');
    out.hidden=false;
    out.textContent=lastDiagnostic;
  };
  const diagnostic=(outcome,code='')=>{
    // Fixed stage names and allowlisted error codes only: never log exceptions,
    // tokens, UUIDs, paths, phone numbers or raw server response bodies.
    const allowedStages=new Set(['permission','local-device','enrollment','family-grant','service-start','verification']);
    const allowedCodes=new Set(['permission_denied','bridge_owner_login_required','bridge_owner_backend_unavailable','bridge_owner_denied','bridge_owner_request_failed','bridge_owner_invalid_response','bridge_owner_keystore_failed','bridge_owner_invalid_local_registration','bridge_owner_device_unavailable','bridge_owner_activation_denied','bridge_owner_not_approved','bridge_invalid_device','bridge_owner_required','bridge_unique_admin_required','bridge_admin_not_unique','bridge_owner_control_denied','bridge_tx_notifications_required','bridge_tx_permission_or_device_missing','bridge_tx_cannot_start','bridge_tx_start_not_confirmed','unknown']);
    const stage=allowedStages.has(activationStage)?activationStage:'verification';
    const safeCode=allowedCodes.has(code)?code:'unknown';
    lastDiagnostic='Bridge '+stage+' / '+safeCode;
    console.info('[FreePT Bridge activation]',{stage,outcome:outcome==='success'?'success':'failure',code:safeCode});
  };
  const alive=()=>panel.isConnected&&me?.id===currentOwner&&profile?.status==='approved'&&profile.role==='user';
  const update=message=>{if(alive())status.textContent=message;};
  const stageDescriptions=Object.freeze({
    permission:'controllo iniziale',
    'local-device':'controllo del telefono',
    enrollment:'registrazione del telefono',
    'family-grant':'autorizzazione del collegamento',
    'service-start':'avvio del servizio',
    verification:'verifica del collegamento'
  });
  let stageTimer=null;
  const setStage=name=>{
    activationStage=name;
    const description=stageDescriptions[name]||'verifica';
    if(stageTimer!==null)clearTimeout(stageTimer);
    // Report progress only: do not cancel an enrollment or a grant that may
    // still finish safely on the server. Never trigger a duplicate request.
    lastDiagnostic='Bridge '+name+' / in_progress';
    update('Attivazione…');
    stageTimer=setTimeout(()=>{
      if(working&&alive()&&activationStage===name){
        // Keep the status quiet; technical details remain available only
        // through the deliberate five-tap support diagnostic.
        lastDiagnostic='Bridge '+name+' / waiting';
      }
    },20000);
  };
  panel.querySelector('#closeOwnerBridge').onclick=()=>panel.remove();
  const refresh=async()=>{
    if(!alive())return;
    try{
      const [permission,device]=await Promise.all([bridgeAllFiles.status(),bridgeOwnerClient.status()]);
      if(!alive())return;
      if(!permission?.granted||!device?.provisioned){
        button.hidden=false;
        update('');
        return;
      }
      const [settings,grants,service]=await Promise.all([
        bridgeOwnerControls.device(device.deviceId),
        bridgeOwnerControls.recipients(device.deviceId),
        bridgeTxControl.status()
      ]);
      if(!alive())return;
      const ready=settings.enabled&&grants.some(g=>g.active);
      button.hidden=ready&&service?.running===true;
      update(ready&&service?.running?'Pronto':'');
    }catch{update('');}
  };
  button.onclick=async()=>{
    if(working||!alive())return;
    working=true;button.disabled=true;
    lastDiagnostic='';
    const out=panel.querySelector('#bridgeFamilyDiagnostic');
    out.hidden=true;out.textContent='';
    try{
      update('Attivazione…');
      setStage('permission');
      // A saved Android grant is reused; never reopen system settings for it.
      const existing=await bridgeAllFiles.status();
      const permission=existing?.granted===true?existing:await bridgeAllFiles.requestPermission();
      if(!alive())return;
      if(permission?.granted!==true){
        diagnostic('failure','permission_denied');
        update('Operazione non riuscita.');return;
      }
      setStage('local-device');
      const current=await bridgeOwnerClient.status();
      setStage('enrollment');
      const device=current?.provisioned?current:await bridgeOwnerClient.enroll('Dispositivo FreePT');
      if(!alive())return;
      // One explicit family-owner consent. The staging database atomically
      // authorizes only the unique approved admin, or refuses the action.
      // No grant is made to guessed or arbitrary recipients.
      setStage('family-grant');
      // Already-authorized connections need only a native TX restart.
      const [settings,grants]=await Promise.all([
        bridgeOwnerControls.device(device.deviceId),
        bridgeOwnerControls.recipients(device.deviceId)
      ]);
      if(!alive())return;
      if(!settings.enabled||!grants.some(grant=>grant.active))
        await bridgeOwnerControls.activateFamily(device.deviceId);
      if(!alive())return;
      setStage('service-start');
      await bridgeTxControl.start();
      if(!alive())return;
      setStage('verification');
      // start() acknowledges a request, not a running foreground service.
      // Never mark activation successful until both the server grant and
      // Android foreground-service state have actually been observed.
      let verified=false;
      for(let attempt=0;attempt<5;attempt++){
        if(!alive())return;
        const [settings,grants,service]=await Promise.all([
          bridgeOwnerControls.device(device.deviceId),
          bridgeOwnerControls.recipients(device.deviceId),
          bridgeTxControl.status()
        ]);
        if(settings?.enabled===true&&Array.isArray(grants)&&
           grants.some(grant=>grant.active===true)&&service?.running===true){
          verified=true;break;
        }
        if(attempt<4)await new Promise(resolve=>setTimeout(resolve,350));
      }
      if(!verified)throw Error('bridge_tx_start_not_confirmed');
      await refresh();
      diagnostic('success');
    }catch(error){
      diagnostic('failure',error instanceof Error?error.message:'unknown');
      // Diagnostics are intentionally kept off the family-facing screen.
      // No raw exception, access token or device secret is displayed.
      update('Operazione non riuscita.');
    }finally{
      if(stageTimer!==null)clearTimeout(stageTimer);
      stageTimer=null;
      working=false;
      if(alive())button.disabled=false;
    }
  };
  await refresh();
}

let importantAlertChecking=false;
let importantAlertShown=null;
async function checkImportantAlerts(){
  if(importantAlertChecking||importantAlertShown||document.visibilityState!=='visible'||
     !me?.id||profile?.role!=='user'||profile?.status!=='approved')return;
  importantAlertChecking=true;
  const owner=me.id;
  try{
    const {data,error}=await db.from('important_alerts')
      .select('id,title,body,apk_attachment,created_at').eq('recipient_id',owner)
      .is('read_at',null).order('created_at',{ascending:true}).limit(1);
    if(error){if(error.code!=='42P01'&&error.code!=='PGRST205')console.warn('FreePT alert fetch failed',error.code);return;}
    const alert=data?.[0];
    if(!alert||me?.id!==owner||profile?.role!=='user'||importantAlertShown)return;
    importantAlertShown=alert.id;
    renderImportantAlert({host:document.body,alert:{...alert,apk:alert.apk_attachment},
      updater:freeptUpdater?createUpdaterClient({plugin:freeptUpdater}):null,onAcknowledge:async id=>{
      if(me?.id!==owner||profile?.role!=='user')throw Error('Sessione cambiata.');
      const {data:updated,error:ackError}=await db.from('important_alerts')
        .update({read_at:new Date().toISOString()}).eq('id',id)
        .eq('recipient_id',owner).is('read_at',null).select('id');
      if(ackError)throw ackError;
      if(!updated?.length)throw Error('Conferma non registrata.');
      importantAlertShown=null;
      queueMicrotask(()=>void checkImportantAlerts());
    }});
  }finally{importantAlertChecking=false;}
}
function showImportantAlertComposer(targetUser){
  if(profile?.role!=='admin'||profile?.status!=='approved'||!adminUnlocked||!me?.id)return;
  const user=people.find(p=>p.id===targetUser?.id&&p.status==='approved');
  if(!user)return;
  const owner=me.id;
  const recipient=user.id;
  mountImportantAlertComposer({host:document.body,recipientName:user.full_name||'Utente',
    onSend:async payload=>{
      if(me?.id!==owner||profile?.role!=='admin'||!adminUnlocked||!people.some(p=>p.id===recipient&&p.status==='approved'))
        throw Error('La conversazione selezionata è cambiata.');
      const {data,error}=await db.functions.invoke('freept-important-alert',{
        body:{recipientId:recipient,...payload}
      });
      if(error)throw Error('Servizio notifiche non disponibile.');
      if(!data?.saved)throw Error('Conferma del server mancante.');
      return data;
    }
  });
}
let openChatRemoteFiles=async()=>{};
function renderLayout(){
  closeAdminOverlays();
  const admin=profile.role==='admin';
  el.innerHTML='<div class="shell">'+heading('FreePT', admin?'<button type="button" id="adminBridge">Bridge</button><button id="logout">Esci</button>':'')+
    '<div class="workspace">'+(admin?'<aside id="people" class="people"></aside>':'')+
    '<section id="chat" class="chat '+(admin?'off':'')+'"><div class="toolbar">'+
    (admin?'<button class="mobileBack" id="back">‹</button>':'')+
    '<strong class="grow" id="chatTitle">Servizio</strong></div>'+ 
    (admin?'<nav id="freeptConversationNav" class="freept-conversation-nav" aria-label="Funzioni conversazione">'+
      '<button type="button" id="chatMessagesView" aria-current="page">💬 Chat</button>'+
      '<button type="button" id="chatRemoteFilesView">📁 File remoti</button>'+
      '<button type="button" id="importantAlertSend">🔔 Avviso</button></nav>':
      (bridgeOwnerClient?'<nav class="freept-owner-nav" aria-label="Condivisione file">'+
        '<button type="button" id="ownerBridgeOpen">📁 Accesso ai file</button></nav>':'')) +
    '<div class="feed" id="feed"></div><div class="hint" id="queued"></div>'+
    '<form class="compose" id="send"><label class="attach" for="file">📎</label>'+
    '<input type="file" id="file" name="file"/><textarea name="text" placeholder="Scrivi un messaggio" maxlength="10000"></textarea>'+
    '<button id="sendBtn">Invia</button><span class="chosen-file" data-file-name></span></form>'+
    '<p id="status" class="hint"></p></section></div></div>';
  // Never show an Android file-permission or re-enrollment sheet on app open.
  // An already-paired phone recovers the TX service separately, while the
  // owner can explicitly open Accesso ai file if Android really revoked access.
  if(!admin){
    const ownerOpen=document.getElementById('ownerBridgeOpen');
    if(ownerOpen)ownerOpen.onclick=()=>void showOwnerBridgeFolder();
  }
  if(admin){
    document.getElementById('logout').onclick=logout;
    document.getElementById('adminBridge').onclick=showAdminBridge;
    document.getElementById('importantAlertSend').onclick=()=>{
      const user=people.find(person=>person.id===selected&&person.status==='approved');
      if(user)showImportantAlertComposer(user);
    };
    document.getElementById('chatMessagesView').onclick=()=>showChatMessages();
    document.getElementById('chatRemoteFilesView').onclick=()=>void openChatRemoteFiles();
    const setConversationTab=tab=>{
      const nav=document.getElementById('freeptConversationNav');
      if(!nav)return;
      nav.querySelectorAll('button').forEach(button=>{
        if((tab==='files'&&button.id==='chatRemoteFilesView') ||
           (tab==='chat'&&button.id==='chatMessagesView'))button.setAttribute('aria-current','page');
        else button.removeAttribute('aria-current');
      });
    };
    const showChatMessages=()=>{
      if(guardBridgeNavigation())return;
      setConversationTab('chat');
      if(typeof chatFilesCleanup==='function')chatFilesCleanup();
      chatFilesCleanup=null;
      document.getElementById('feed').hidden=false;
      document.getElementById('send').hidden=false;
      document.getElementById('chatRemoteFilesPanel')?.remove();
    };
    openChatRemoteFiles=async()=>{
      if(guardBridgeNavigation())return;
      const user=people.find(person=>person.id===selected);
      if(!user||user.status!=='approved'||!adminUnlocked||profile?.role!=='admin')return;
      document.getElementById('feed').hidden=true;
      document.getElementById('send').hidden=true;
      setConversationTab('files');
      let panel=document.getElementById('chatRemoteFilesPanel');
      if(!panel){
        panel=document.createElement('section');
        panel.id='chatRemoteFilesPanel';
        panel.setAttribute('role','status');
        document.getElementById('feed').after(panel);
      }
      // Keep the original compact conversation toolbar. Navigation back to
      // messages stays local to the remote-files panel, not in the chat bar.
      let nav=panel.querySelector('.bridge-return-to-chat');
      if(!nav){
        nav=document.createElement('button');
        nav.type='button';nav.className='bridge-return-to-chat';
        nav.textContent='‹ Torna alla chat';
        nav.onclick=showChatMessages;
        panel.prepend(nav);
      }
      if(!bridgeClient||!bridgeDestination){
        const filesHost=panel.querySelector('.bridge-files-content')||document.createElement('div');
        filesHost.className='bridge-files-content';
        filesHost.textContent='Collegamento file non disponibile: il server Bridge HTTPS non è configurato.';
        panel.append(filesHost);
        return;
      }
      // Do not restart the same pending root browse request when the tab is
      // tapped twice: the old version cancelled it and queued another.
      if(panel.dataset.bridgeOwnerId===user.id&&typeof chatFilesCleanup==='function')
        return;
      if(typeof chatFilesCleanup==='function')chatFilesCleanup();
      panel.querySelector('.bridge-files-content')?.remove();
      const ownerId=user.id;
      panel.dataset.bridgeOwnerId=ownerId;
      const filesHost=document.createElement('div');
      filesHost.className='bridge-files-content';
      panel.append(filesHost);
      chatFilesCleanup=renderBridgeRemoteFiles({
        host:filesHost,db,bridgeClient,bridgeDestination,adminId:me.id,ownerId,ownerName:user.full_name||'Persona',
        isAuthorized:()=>panel.isConnected&&selected===ownerId&&
          me?.id&&profile?.role==='admin'&&adminUnlocked
      });
    };
    renderPeople();
    document.getElementById('back').onclick=()=>{
      if(guardBridgeNavigation())return;
      if(typeof chatFilesCleanup==='function')chatFilesCleanup();
      chatFilesCleanup=null;
      document.getElementById('chatRemoteFilesPanel')?.remove();
      document.getElementById('chat').classList.add('off');
      document.getElementById('people').classList.remove('off');
    };
  }
  document.getElementById('send').onsubmit=send;
  configureFileInput(document.getElementById('file'));
}
function renderPeople(){
  const p=document.getElementById('people');
  if(!p)return;
  const visiblePeople=filterAdminPeople(people,adminPeopleQuery,adminPeopleStatus);
  p.innerHTML='<div class="admin-people-tools"><strong>Utenti ('+visiblePeople.length+'/'+people.length+')</strong>'+
    '<input type="search" id="adminPeopleSearch" aria-label="Cerca utenti" placeholder="Cerca nome, telefono o email" value="'+esc(adminPeopleQuery)+'">'+
    '<select id="adminPeopleStatus" aria-label="Filtra utenti per stato">'+
    [['all','Tutti'],['pending','Da approvare'],['approved','Approvati'],['blocked','Bloccati']].map(([key,label])=>
      '<option value="'+key+'"'+(adminPeopleStatus===key?' selected':'')+'>'+label+'</option>').join('')+
    '</select></div><div id="adminPeopleResults">'+
    '<p class="hint" id="adminPeopleEmpty"'+(visiblePeople.length?' hidden':'')+'>Nessun utente corrisponde ai filtri.</p>'+
    people.map(x=>'<button class="person" data-id="'+esc(x.id)+'"><strong>'+esc(x.full_name)+'</strong><br><small>'+
      esc(x.email||x.phone)+' · '+(x.email?'Windows':'Android')+' · '+(x.status==='pending'?'NUOVA RICHIESTA':esc(x.status))+'</small>'+
      (x.lastMessage?'<span class="chat-preview">'+
        esc((x.lastMessage.body||('📎 '+(x.lastMessage.file_name||'Allegato'))).slice(0,90))+
        '</span>':'')+
      (x.status==='pending'?'<br><span data-approve="'+esc(x.id)+'">✓ Approva</span> <span data-deny="'+esc(x.id)+'">✕ Rifiuta</span>':'')+
      '</button>').join('')+'</div>';
  const search=p.querySelector('#adminPeopleSearch');
  const filter=p.querySelector('#adminPeopleStatus');
  search.oninput=()=>{
    adminPeopleQuery=search.value;
    // Keep the keyboard open on Android: replace results, not the active input.
    updateAdminPeopleResults();
  };
  filter.onchange=()=>{adminPeopleStatus=filter.value;updateAdminPeopleResults();};
  bindAdminPeopleActions(p);
  updateAdminPeopleResults();
}
function updateAdminPeopleResults(){
  const p=document.getElementById('people');
  if(!p)return;
  const filtered=filterAdminPeople(people,adminPeopleQuery,adminPeopleStatus);
  p.querySelector('.admin-people-tools strong').textContent='Utenti ('+filtered.length+'/'+people.length+')';
  // Keep existing user buttons, their listeners and any selected conversation intact.
  for(const button of p.querySelectorAll('[data-id]'))
    button.hidden=!filtered.some(user=>user.id===button.dataset.id);
  const empty=p.querySelector('#adminPeopleEmpty');
  if(empty)empty.hidden=filtered.length>0;
}
function bindAdminPeopleActions(p){
  p.querySelectorAll('[data-id]').forEach(button=>{
    let holdTimer=null;
    let suppressClick=false;
    let startX=0,startY=0;
    const id=button.dataset.id;
    const stopHold=()=>{if(holdTimer){clearTimeout(holdTimer);holdTimer=null}};
    const showActions=()=>{
      stopHold();
      suppressClick=true;
      const user=people.find(x=>x.id===id);
      if(user)showConversationActions(user);
    };
    button.addEventListener('pointerdown',event=>{
      if(event.pointerType==='mouse'&&event.button!==0)return;
      startX=event.clientX;startY=event.clientY;
      stopHold();
      holdTimer=setTimeout(showActions,650);
    });
    button.addEventListener('pointermove',event=>{
      if(Math.abs(event.clientX-startX)>12||Math.abs(event.clientY-startY)>12)stopHold();
    });
    for(const type of ['pointerup','pointercancel','pointerleave'])button.addEventListener(type,stopHold);
    button.addEventListener('contextmenu',event=>{event.preventDefault();showActions()});
    button.onclick=async event=>{
      if(suppressClick){suppressClick=false;event.preventDefault();return}
      if(event.target.dataset.approve||event.target.dataset.deny){
        event.stopPropagation();
        const approved=!!event.target.dataset.approve;
        if(!confirm(approved?'Approvare questo utente?':'Rifiutare questa richiesta?'))return;
        const {error}=await db.from('profiles').update({status:approved?'approved':'blocked'}).eq('id',id);
        if(error)alert(friendly(error));
        else{await listPeople();renderPeople()}
        return;
      }
      const user=people.find(x=>x.id===id);
      if(user?.status!=='approved')return;
      if(guardBridgeNavigation())return;
      selected=id;messageRequest++;
      if(typeof chatFilesCleanup==='function')chatFilesCleanup();
      chatFilesCleanup=null;
      document.getElementById('chatRemoteFilesPanel')?.remove();
      document.getElementById('feed').hidden=false;
      document.getElementById('send').hidden=false;
      const nav=document.getElementById('freeptConversationNav');
      nav?.querySelector('#chatMessagesView')?.setAttribute('aria-current','page');
      nav?.querySelector('#chatRemoteFilesView')?.removeAttribute('aria-current');
      document.getElementById('chat').classList.remove('off');
      p.classList.add('off');
      document.getElementById('chatTitle').textContent=user.full_name||'Chat';
      await showMessages();
    };
  });
}

function showConversationActions(user){
  if(profile?.role!=='admin'||!adminUnlocked)return;
  const old=document.getElementById('chatActions');
  if(old)old.remove();
  const modal=document.createElement('div');
  modal.id='chatActions';
  modal.className='chat-actions-shade';
  modal.setAttribute('role','dialog');
  modal.setAttribute('aria-modal','true');
  modal.setAttribute('aria-label','Gestione conversazione');
  modal.innerHTML='<div class="chat-actions-box"><h3>'+esc(user.full_name)+'</h3>'+
    '<p>Che cosa vuoi fare?</p>'+
    (user.status==='approved'?'<button type="button" id="openFilesAction">File e cartelle</button>':'')+
    (user.status==='approved'?'<button type="button" id="sendImportantAction">Invia avviso importante</button>':'')+
    '<button type="button" id="clearChatAction">Cancella chat</button>'+ 
    '<button type="button" class="danger" id="deleteUserAction">Elimina utente</button>'+
    '<button type="button" class="secondary" id="cancelChatAction">Annulla</button>'+
    '<p id="actionStatus" class="small"></p></div>';
  el.appendChild(modal);
  const close=()=>modal.remove();
  modal.onclick=event=>{if(event.target===modal)close()};
  document.getElementById('cancelChatAction').onclick=close;
  const filesAction=document.getElementById('openFilesAction');
  if(filesAction)filesAction.onclick=()=>{
    close();
    // The long-press menu may belong to a person other than the selected chat.
    const owner=user.id;
    if(selected!==owner){
      selected=owner;messageRequest++;
      if(typeof chatFilesCleanup==='function')chatFilesCleanup();
      chatFilesCleanup=null;
      document.getElementById('chatRemoteFilesPanel')?.remove();
      document.getElementById('chat')?.classList.remove('off');
      document.getElementById('people')?.classList.add('off');
      const heading=document.getElementById('chatTitle');
      if(heading)heading.textContent=user.full_name||'Chat';
    }
    void openChatRemoteFiles();
  };
  const alertAction=document.getElementById('sendImportantAction');
  if(alertAction)alertAction.onclick=()=>{close();showImportantAlertComposer(user);};
  const run=async deleteUser=>{
    if(!deleteMigrationReady){
      const statusNode=document.getElementById('actionStatus');
      statusNode.textContent='Prima devi applicare in Supabase la migrazione 20261105_delete_chats_users.sql.';
      statusNode.className='error';
      return;
    }
    const name=user.full_name;
    const question=deleteUser
      ? 'ELIMINARE DEFINITIVAMENTE '+name+'? Verranno rimossi account, accesso, messaggi e allegati. Non si puo annullare.'
      : 'CANCELLARE tutta la chat con '+name+' e i suoi allegati? L’utente rimarra autorizzato e potra scrivere di nuovo. Non si puo annullare.';
    if(!confirm(question))return;
    modal.querySelectorAll('button').forEach(b=>b.disabled=true);
    const statusNode=document.getElementById('actionStatus');
    statusNode.textContent='Verifica delle autorizzazioni...';
    try{
      // Do not touch Storage until the backend migration and admin check succeed.
      const readiness=await db.rpc('freept_delete_ready');
      if(readiness.error)throw new Error('Migrazione SQL non pronta: '+friendly(readiness.error));
      if(readiness.data!==true)throw new Error('Autorizzazione amministratore negata.');
      // Database deletion is atomic. Do not remove Storage objects beforehand:
      // a timeout/rejected RPC must never strip attachments from a live account.
      statusNode.textContent=deleteUser?'Eliminazione account in corso...':'Cancellazione chat in corso...';
      const {error}=await db.rpc('freept_admin_delete_conversation',{
        p_user_id:user.id,p_delete_user:deleteUser
      });
      if(error)throw error;
      statusNode.textContent='Account/chat eliminati. Pulizia allegati in corso...';
      let storageWarning=false;
      try{await deleteConversationFiles(user.id)}
      catch{storageWarning=true;}
      close();
      if(storageWarning)alert('Account/chat eliminati, ma alcuni allegati potrebbero essere rimasti nello Storage. Controllare la pulizia separatamente.');
      if(selected===user.id){
        selected=null;messageRequest++;
        document.getElementById('chat')?.classList.add('off');
        document.getElementById('people')?.classList.remove('off');
      }
      await listPeople();renderPeople();
    }catch(e){
      statusNode.textContent='Operazione non completata: '+friendly(e)+
        '. Nessun allegato e stato rimosso da questa operazione se il database ha rifiutato la cancellazione.';
      statusNode.className='error';
    }finally{
      if(document.contains(modal))modal.querySelectorAll('button').forEach(b=>b.disabled=false);
    }
  };
  document.getElementById('clearChatAction').onclick=()=>run(false);
  document.getElementById('deleteUserAction').onclick=()=>run(true);
}

// The Storage API must remove the physical objects before the database RPC.
// Supabase Storage objects are organized under user_id / message UUID / filename.
async function deleteConversationFiles(userId){
  if(!/^[0-9a-f-]{36}$/i.test(userId))throw Error('Identificativo utente non valido.');
  const files=[];
  const walk=async (prefix,depth)=>{
    if(depth>3)throw Error('Struttura allegati inattesa.');
    for(let offset=0;;offset+=100){
      const {data,error}=await db.storage.from('attachments').list(prefix,{
        limit:100,offset,sortBy:{column:'name',order:'asc'}
      });
      if(error)throw error;
      if(!data?.length)break;
      for(const entry of data){
        const path=prefix+'/'+entry.name;
        if(entry.id===null||entry.id===undefined){
          await walk(path,depth+1);
        }else{
          files.push(path);
          if(files.length>10000)throw Error('Troppi allegati: eliminazione interrotta per sicurezza.');
        }
      }
      if(data.length<100)break;
    }
  };
  await walk(userId,0);
  for(let i=0;i<files.length;i+=100){
    const {error}=await db.storage.from('attachments').remove(files.slice(i,i+100));
    if(error)throw error;
  }
}

async function copyAdminChatText(value){
  if(profile?.role!=='admin'||profile?.status!=='approved'||!adminUnlocked||!me?.id) return;
  if(freeptAdminShare)await freeptAdminShare.copyText({text:value});
  else if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(value);
  else throw Error('Copia non disponibile');
  status('Testo copiato.');
}
function mountAdminChatShareActions(feed){
  if(profile?.role!=='admin'||profile?.status!=='approved'||!adminUnlocked||!me?.id)return;
  feed.querySelectorAll('article.bubble').forEach((bubble,index)=>{
    const message=messages[index];
    if(!message||(!message.body&&!message.file_path))return;
    const actions=document.createElement('div');
    actions.className='admin-chat-share-actions';
    actions.style.cssText='display:flex;gap:5px;flex-wrap:wrap;margin-top:7px';
    const button=(label,action)=>{
      const b=document.createElement('button');b.type='button';
      b.textContent=label;b.style.cssText='padding:5px 9px;font-size:12px';
      b.onclick=async()=>{
        b.disabled=true;
        try{await action()}catch(error){
          status('Operazione non riuscita: '+(error?.message||'errore'),true);
        }finally{b.disabled=false}
      };actions.appendChild(b);
    };
    if(message.body){
      button('Copia',()=>copyAdminChatText(message.body));
    }
    bubble.appendChild(actions);
  });
}
async function showMessages(scroll=true){if(!selected)return;const requestedUser=selected, requestId=++messageRequest;let query=db.from('messages').select('id,user_id,sender_id,body,file_path,file_name,created_at').eq('user_id',requestedUser).order('created_at',{ascending:false}).limit(200);const {data,error}=await query;if(requestId!==messageRequest || requestedUser!==selected)return;if(error){status(friendly(error),true);return}messages=(data||[]).reverse();const feed=document.getElementById('feed');if(!feed)return;const nearEnd=feed.scrollHeight-feed.scrollTop-feed.clientHeight<100;feed.innerHTML=messages.map(m=>'<article class="bubble '+(m.sender_id===me.id?'mine':'other')+'">'+(m.body?esc(m.body):'')+(m.file_path?'<div class="attach-host" data-file="'+esc(m.file_path)+'" data-name="'+esc(m.file_name||'Allegato')+'"></div>':'')+'<small>'+new Date(m.created_at).toLocaleString('it-IT')+'</small></article>').join('');if(profile?.role!=='admin'){
  const queue=document.getElementById('queued');
  if(queue){
    const last=messages[messages.length-1];
    const awaiting=last && last.sender_id===me.id;
    queue.textContent=awaiting?'Richiesta in elaborazione… Attendere.':'';
    queue.classList.toggle('processing',!!awaiting);
  }
} feed.querySelectorAll('.attach-host').forEach(host=>{try{renderChatAttachment({container:host,fileName:host.dataset.name,filePath:host.dataset.file,signUrl:signAttachmentUrl,makeWriter:bridgeDestination?(profile?.role==='admin'?adminAttachmentWriter(requestedUser):makeChatWriter):null,escape:esc,setStatus:msg=>status(msg)});}catch{host.textContent='📎 '+esc(host.dataset.name||'Allegato');}});mountAdminChatShareActions(feed);if(scroll||nearEnd)feed.scrollTop=feed.scrollHeight}
async function signAttachmentUrl(path){const {data,error}=await db.storage.from('attachments').createSignedUrl(path,3600);if(error||!data?.signedUrl)throw Error('Indirizzo allegato non disponibile.');return data.signedUrl;}
async function makeChatWriter(meta){if(!bridgeDestination)return null;let dest=null;try{dest=await bridgeDestination.getDestination();}catch{}if(!dest?.selected)await bridgeDestination.chooseDestination();return createBridgeAndroidSingleFileWriter({plugin:bridgeDestination,name:meta.name,size:meta.size,mime:meta.mime});}
function adminAttachmentWriter(ownerId){
  // Capture identity when rendering, before an attachment fetch or picker.
  const actor=me?.id;
  const ownerName=people.find(p=>p.id===ownerId)?.full_name||'Persona';
  const allowed=()=>profile?.role==='admin'&&profile?.status==='approved'&&adminUnlocked&&
    !!actor&&me?.id===actor&&selected===ownerId&&people.some(p=>p.id===ownerId&&p.status==='approved');
  return async meta=>{
    if(!allowed())throw Error('Download non autorizzato');
    let dest=null;try{dest=await bridgeDestination.getDestination();}catch{}
    if(!dest?.selected)await bridgeDestination.chooseDestination();
    if(!allowed())throw Error('Download non autorizzato');
    const writer=await createBridgeAndroidSingleFileWriter({plugin:bridgeDestination,
      name:meta.name,size:meta.size,mime:meta.mime,ownerId,ownerName});
    const protect=action=>async(...args)=>{
      try{if(!allowed())throw Error('Download non autorizzato');return await action(...args);}
      catch(error){await writer.discard();throw error;}
    };
    return {write:protect(writer.write),commit:protect(writer.commit),discard:writer.discard};
  };
}
// Small files keep the proven Storage SDK path. Larger files use resumable
// chunks with retries so mobile connections can recover without changing photos.
async function uploadAttachment(path,file,onProgress){
  const bucket=db.storage.from('attachments');
  if(file.size<=6*1024*1024){
    const {error}=await bucket.upload(path,file,{
      contentType:file.type||'application/octet-stream',upsert:false
    });
    if(error)throw error;
    onProgress?.(100);
    return;
  }
  const {data,error}=await db.auth.getSession();
  if(error)throw error;
  const token=data?.session?.access_token;
  if(!token)throw Error('Sessione scaduta: riapri FreePT.');
  // Use the validated Supabase configuration. (The global `URL` is the browser
  // constructor, not a string; `KEY` was never defined — this blocked every
  // attachment above 6 MB from uploading.)
  const projectUrl=config.url;
  const storageUrl=projectUrl.includes('.supabase.co')
    ? projectUrl.replace('.supabase.co','.storage.supabase.co') : projectUrl;
  const endpoint=storageUrl.replace(/\/$/,'')+'/storage/v1/upload/resumable';
  await new Promise((resolve,reject)=>{
    const upload=new tus.Upload(file,{
      endpoint,
      headers:{authorization:'Bearer '+token,apikey:config.key},
      retryDelays:[0,1000,3000,5000,10000],
      uploadDataDuringCreation:true,
      removeFingerprintOnSuccess:true,
      metadata:{
        bucketName:'attachments',
        objectName:path,
        contentType:file.type||'application/octet-stream'
      },
      chunkSize:6*1024*1024,
      onError:reject,
      onProgress:(sent,total)=>onProgress?.(total?Math.round(sent/total*100):0),
      onSuccess:resolve
    });
    upload.start();
  });
}

async function send(ev){ev.preventDefault();if(busy||!selected)return;const form=ev.target,body=form.elements.text.value.trim(),file=form.elements.file.files[0];if(!body&&!file)return;if(file&&file.size>25*1024*1024){status('Allegato troppo grande: massimo 25 MB',true);return}busy=true;document.getElementById('sendBtn').disabled=true;status('Invio in corso...');let path=null;try{if(file){const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,120)||'file';path=selected+'/'+crypto.randomUUID()+'/'+safe;await uploadAttachment(path,file,percent=>status('Caricamento allegato: '+percent+'%'))}const id=crypto.randomUUID();const payload={id,user_id:selected,sender_id:me.id,body,file_path:path,file_name:file?.name||null};const {error}=await db.from('messages').insert(payload);if(error)throw error;form.reset();const fileLabel=form.querySelector('[data-file-name]');if(fileLabel)fileLabel.textContent='';status('Richiesta inviata.');await showMessages()}catch(e){status('Invio non completato: '+friendly(e)+(path?' (allegato caricato; invio del messaggio da verificare)':''),true)}finally{busy=false;document.getElementById('sendBtn').disabled=false}}
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible'&&filePickerActive){
    filePickerReturned=true;
    if(filePickerClearTimer)clearTimeout(filePickerClearTimer);
    // On Android the chooser may return without change/cancel; do not leave a
    // permanent bypass of the background biometric lock.
    filePickerClearTimer=setTimeout(finishFilePicker,1800);
  }
  // Backgrounding is not logout: retain the authenticated workspace and
  // biometric unlock until the Android WebView process is restarted or the
  // user explicitly signs out. Cold starts still run boot()/unlockAdmin().

});
boot();
// One-time, non-blocking update check for every FreePT user (admin and normal).
// The banner only appears if the locked endpoint offers a strictly newer APK.
if(freeptUpdater){
  try{
    const updater=createUpdaterClient({plugin:freeptUpdater});
    mountUpdaterBanner({host:document.body,updater,escape:esc});
    let lastCheck=Date.now();
    document.addEventListener('visibilitychange',()=>{
      if(document.visibilityState==='visible'&&Date.now()-lastCheck>1800000){
        lastCheck=Date.now();
        if(!document.getElementById('updateBanner'))
          mountUpdaterBanner({host:document.body,updater,escape:esc});
      }
    });
  }catch{/* updater must never break app startup */}
}
// Polling leggero quando l'app è in primo piano: recupera anche eventi realtime persi.
setInterval(async () => {
  if(document.visibilityState!=='visible' || !me || profile?.status!=='approved' || !selected || fetchingMessages || bridgeTransferActive())return;
  fetchingMessages=true;
  try{await showMessages(false)}finally{fetchingMessages=false}
}, 6000);
setInterval(async () => {
  if(document.visibilityState!=='visible' || !me || !profile || bridgeTransferActive()) return;
  try {
    if(profile.status==='pending'){
      await loadProfile();
      if(profile.status==='approved') await renderWorkspace(); else if(profile.status==='blocked') requestScreen(true);
    } else if(profile.status==='approved' && profile.role==='admin'){
      await listPeople();
      renderPeople();
    } else if(profile.status==='approved' && profile.role==='user'){
      void checkImportantAlerts();
      void bindBootstrapAfterApproval();
      void startProvisionedTxWhenAllowed();
    }
  } catch(e){ status(friendly(e),true) }
}, 20000);
