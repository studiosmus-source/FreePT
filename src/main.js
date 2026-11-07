import { createClient } from '@supabase/supabase-js';
import './style.css';
import { Capacitor } from '@capacitor/core';
import { NativeBiometric } from '@capgo/capacitor-native-biometric';
import * as tus from 'tus-js-client';

const URL = import.meta.env.VITE_SUPABASE_URL || 'https://cpopqsvzzxfjgnlawlvc.supabase.co';
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_Q74UCgQUXO6f_7vZhXcbyg_2KRl2OSN';
const db = createClient(URL, KEY, { auth: { persistSession: true, autoRefreshToken: true } });
const el = document.getElementById('app');
let me = null, profile = null, people = [], selected = null, messages = [], sub = null, busy = false;
let messageRequest = 0;
let fetchingMessages = false;
let adminUnlocked = false;
let adminUnlocking = false;
let awaySince = 0;
let deleteMigrationReady = true;
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
  if(adminUnlocked)return true;
  if(adminUnlocking)return false;
  if(!Capacitor.isNativePlatform()){
    // Browser admin login was verified by Supabase; no native biometrics here.
    // Keep the UI lock state consistent with the successful authentication.
    adminUnlocked=true;
    return true;
  }
  adminUnlocking=true;
  try{
    const available=await NativeBiometric.isAvailable();
    if(!available.isAvailable)throw Error('Impronta non disponibile: usa l’accesso amministratore.');
    await NativeBiometric.verifyIdentity({reason:'Sblocca FreePT amministratore',title:'FreePT',subtitle:'Accesso amministratore'});
    adminUnlocked=true;return true;
  }catch(e){
    el.innerHTML='<div class="shell">'+heading('FreePT')+'<main class="panel"><h2>Area amministratore bloccata</h2><p>Per accedere conferma l’impronta sul telefono.</p><button id="unlock">Sblocca con impronta</button><p id="status" class="small"></p></main></div>';
    document.getElementById('unlock').onclick=async()=>{if(await unlockAdmin())await renderWorkspace()};
    status(friendly(e),true);
    return false;
  }finally{adminUnlocking=false}
}

const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const friendly = e => e?.message || 'Operazione non riuscita';
function status(msg, bad=false){ const n=document.getElementById('status'); if(n){n.textContent=msg;n.className=bad?'error':'small'} }
function phoneNorm(s){ return s.replace(/[\s().-]/g,''); }

function heading(t,extra=''){return '<header class="top"><h1>'+esc(t)+'</h1>'+extra+'</header>'}

function requestScreen(denied=false){
  closeAdminOverlays();
  selected=null; messageRequest++;
  el.innerHTML='<div class="shell">'+heading('FreePT')+'<main class="panel"><h2>Richiedi accesso</h2><p class="small">Inserisci il tuo nome e numero di cellulare. Nessuna password e nessun SMS.</p>'+
  '<button type="button" id="adminAccess" class="admin-entry">Accesso amministratore</button>'+
  '<form class="form" id="request"><input name="name" placeholder="Nome e cognome" maxlength="80" minlength="2" required autocomplete="name" '+(denied?'disabled':'')+'/>'+
  '<input name="phone" type="tel" placeholder="Numero di telefono (+39...)" required autocomplete="tel" '+(denied?'disabled':'')+'/>'+
  '<section class="disclaimer" aria-label="Informativa sull’intelligenza artificiale"><h3>FreePT · L’intelligenza artificiale per tutti</h3><p><strong>La potenza di ChatGPT e Claude senza dover sottoscrivere un abbonamento personale.</strong></p><p>Con FreePT puoi fare liberamente domande, inviare richieste, foto e documenti e ricevere risposte elaborate attraverso ChatGPT e Claude. Nessun account personale presso questi servizi è necessario.</p><p class="disclaimer-promise"><strong>SENZA LIMITI*<br>SENZA CENSURA*</strong></p><p class="disclaimer-note">* Salvo particolari condizioni legate alla disponibilità del servizio e alla possibilità di elaborare determinate richieste.</p><p>FreePT è un servizio indipendente, non affiliato a OpenAI o Anthropic.</p><label class="consent"><input name="disclaimer" type="checkbox" required><span>Dichiaro di aver letto e accettato quanto sopra.</span></label></section>'+
  '<button '+(denied?'disabled':'')+'>Invia richiesta di accesso</button></form>'+
  '<p id="status" class="'+(denied?'error':'small')+'">'+(denied?'Richiesta non approvata. Non puoi accedere alla chat.':'')+'</p>'+
  '</main></div>';
  document.getElementById('adminAccess').onclick=adminScreen;
  document.getElementById('request').onsubmit=async ev=>{
    ev.preventDefault();
    const form=ev.target, f=new FormData(form),name=String(f.get('name')||'').trim(),phone=phoneNorm(String(f.get('phone')||''));
    if(name.length<2){status('Inserisci nome e cognome',true);return}
    if(!/^\+[1-9]\d{7,14}$/.test(phone)){status('Inserisci il numero con prefisso, ad esempio +39...',true);return}
    const button=form.querySelector('button');button.disabled=true;status('Invio richiesta in corso...');
    try {
      const {data:sessionData}=await db.auth.getSession();
      let user=sessionData?.session?.user;
      if(!user){
        const auth=await db.auth.signInAnonymously();
        if(auth.error) throw auth.error;
        user=auth.data.user;
      }
      if(!user?.is_anonymous) throw Error('Una sessione amministratore è già attiva.');
      const {error}=await db.from('profiles').insert({id:user.id,full_name:name,phone});
      if(error) throw error;
      await boot();
    }catch(e){
      const message=friendly(e);
      status(message.includes('Anonymous sign-ins are disabled')?'Occorre abilitare gli accessi anonimi nel progetto FreePT.':message,true);
    }finally{button.disabled=false}
  };
}
function adminScreen(){
  closeAdminOverlays();
  el.innerHTML='<div class="shell">'+heading('FreePT')+'<main class="panel"><h2>Accesso amministratore</h2>'+
  '<form id="adminForm" class="form"><input type="email" name="email" autocomplete="username" placeholder="Email amministratore" required>'+
  '<input type="password" name="password" autocomplete="current-password" placeholder="Password" required>'+
  '<button>Accedi</button></form><p id="status" class="small"></p>'+
  '<button id="backRequest" type="button">Torna alla richiesta di accesso</button></main></div>';
  document.getElementById('backRequest').onclick=()=>requestScreen();
  document.getElementById('adminForm').onsubmit=async e=>{
    e.preventDefault();const f=new FormData(e.target);status('Accesso in corso...');
    try {
      const {data:{session}}=await db.auth.getSession();
      if(session?.user?.is_anonymous) await db.auth.signOut();
      const result=await db.auth.signInWithPassword({email:String(f.get('email')),password:String(f.get('password'))});
      if(result.error)throw result.error;
      me=result.data.user;
      await loadProfile();
      if(profile?.role!=='admin'||profile.status!=='approved'){
        await db.auth.signOut();
        me=null;profile=null;
        throw Error('Questo account non è un amministratore autorizzato.');
      }
      if(await unlockAdmin())await renderWorkspace();
    }catch(err){status(friendly(err),true)}
  };
}
function waitingScreen(){
  closeAdminOverlays();
  el.innerHTML='<div class="shell">'+heading('FreePT')+'<main class="panel"><h2>Richiesta inviata</h2>'+
  '<p class="notice waiting-copy">I nostri sistemi stanno elaborando la tua richiesta di accesso… Attendere.</p>'+
  '<p class="small">Puoi lasciare l’app aperta o tornare più tardi.</p><p id="status" class="small"></p></main></div>';
}

async function loadProfile(){const {data,error}=await db.from('profiles').select('id,full_name,phone,role,status').eq('id',me.id).maybeSingle();if(error)throw error;profile=data}
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
    if(!profile){requestScreen();return}
    if(profile.status==='blocked'){requestScreen(true);return}
    if(profile.status==='pending'){waitingScreen();return}
    if(profile.role==='admin' && !(await unlockAdmin()))return;
    await renderWorkspace();
  }catch(e){el.innerHTML='<main class="panel"><h2>Collegamento non riuscito</h2><p>'+esc(friendly(e))+'</p><button id="retry">Riprova</button></main>';document.getElementById('retry').onclick=boot}
}

async function logout(){closeAdminOverlays();adminUnlocked=false;if(sub){db.removeChannel(sub);sub=null}await db.auth.signOut();me=null;profile=null;selected=null;messageRequest++;requestScreen()}
async function listPeople(){
  let result=await db.from('profiles')
    .select('id,full_name,phone,status,role,created_at,chat_hidden_at')
    .neq('role','admin').order('created_at',{ascending:false});
  if(result.error && /chat_hidden_at/i.test(result.error.message||'')){
    // Backwards compatibility: keep normal chat functional before SQL migration.
    deleteMigrationReady=false;
    result=await db.from('profiles')
      .select('id,full_name,phone,status,role,created_at')
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
async function renderWorkspace(){if(profile?.role==='admin'&&!adminUnlocked&&Capacitor.isNativePlatform())return;if(sub){db.removeChannel(sub);sub=null}if(profile.role==='admin')await listPeople();else selected=me.id;renderLayout();if(selected)await showMessages();sub=db.channel('freept-sync').on('postgres_changes',{event:'*',schema:'public',table:'messages'},async()=>{if(selected)await showMessages(false)}).on('postgres_changes',{event:'*',schema:'public',table:'profiles'},async()=>{if(profile.role==='admin'){await listPeople();renderPeople()}}).subscribe();document.addEventListener('visibilitychange',refreshOnVisible,{once:true})}
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
      if(me && profile?.role==='admin' && profile.status==='approved'){
        await listPeople();
        renderPeople();
      }
      if(selected) await showMessages(false);
    } catch(e){ status(friendly(e),true) }
  }
  document.addEventListener('visibilitychange',refreshOnVisible,{once:true});
}
function closeAdminOverlays(){
  document.getElementById('adminBridgePanel')?.remove();
  document.getElementById('chatActions')?.remove();
}

async function loadAdminBridgeDevices(panel){
  const content=panel.querySelector('#bridgeAdminContent');
  if(!content || !panel.isConnected || profile?.role!=='admin' || !adminUnlocked)return;
  // Each tab refresh invalidates older responses so stale data cannot
  // overwrite a newer view after slow network calls.
  const revision=panel.bridgeLoadRevision=(panel.bridgeLoadRevision||0)+1;
  content.textContent='Caricamento dispositivi autorizzati…';
  // RLS only exposes devices this approved account may read.
  // No service-role credential, device presence claim or direct mutation.
  let data,error;
  try {
    ({data,error}=await db.from('bridge_devices')
      .select('id,label,bridge_enabled').order('label',{ascending:true}).limit(100));
  } catch {
    error={code:'bridge_network_unavailable'};
  }
  if(!panel.isConnected || panel.bridgeLoadRevision!==revision ||
      profile?.role!=='admin' || !adminUnlocked ||
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
    '<ul class="bridge-device-list">'+data.map(d=>
      '<li><strong>'+esc(d.label||'Dispositivo')+'</strong> · '+
      (d.bridge_enabled?'Bridge attivato dal proprietario':'Bridge disattivato')+
      '</li>').join('')+'</ul>'+
    (data.length===100?'<p>Visualizzati i primi 100 dispositivi autorizzati.</p>':'');
}

function showAdminBridge(){
  if(profile?.role!=='admin'||!adminUnlocked)return;
  document.getElementById('adminBridgePanel')?.remove();
  const panel=document.createElement('div');
  panel.id='adminBridgePanel';
  panel.className='bridge-admin-shade';
  panel.innerHTML='<section class="bridge-admin-panel" role="dialog" aria-modal="true" aria-label="Bridge">'+
    '<header><h2>Bridge</h2><button type="button" id="closeAdminBridge">Chiudi</button></header>'+
    '<nav><button type="button" data-bridge-view="approvals">Approvazioni</button><button type="button" data-bridge-view="files">File</button></nav>'+
    '<div id="bridgeAdminContent" aria-live="polite"></div></section>';
  document.body.appendChild(panel);
  const show=view=>{
    const content=panel.querySelector('#bridgeAdminContent');
    panel.querySelectorAll('[data-bridge-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.bridgeView===view)));
    if(view==='approvals')void loadAdminBridgeDevices(panel);
    else {
      panel.bridgeLoadRevision=(panel.bridgeLoadRevision||0)+1;
      content.textContent='La consultazione dei file richiede un collegamento Bridge autorizzato e verificato dal backend. Non è ancora disponibile.';
    }
  };
  panel.querySelectorAll('[data-bridge-view]').forEach(b=>b.onclick=()=>show(b.dataset.bridgeView));
  panel.querySelector('#closeAdminBridge').onclick=()=>panel.remove();
  show('approvals');
}

function renderLayout(){
  closeAdminOverlays();
  const admin=profile.role==='admin';
  el.innerHTML='<div class="shell">'+heading('FreePT', admin?'<button type="button" id="adminBridge">Bridge</button><button id="logout">Esci</button>':'')+
    '<div class="workspace">'+(admin?'<aside id="people" class="people"></aside>':'')+
    '<section id="chat" class="chat '+(admin?'off':'')+'"><div class="toolbar">'+
    (admin?'<button class="mobileBack" id="back">‹</button>':'')+
    '<strong class="grow" id="chatTitle">Servizio</strong></div>'+
    '<div class="feed" id="feed"></div><div class="hint" id="queued"></div>'+
    '<form class="compose" id="send"><label class="attach" for="file">📎</label>'+
    '<input type="file" id="file" name="file"/><textarea name="text" placeholder="Scrivi un messaggio" maxlength="10000"></textarea>'+
    '<button id="sendBtn">Invia</button><span class="chosen-file" data-file-name></span></form>'+
    '<p id="status" class="hint"></p></section></div></div>';
  if(admin){
    document.getElementById('logout').onclick=logout;
    document.getElementById('adminBridge').onclick=showAdminBridge;
    renderPeople();
    document.getElementById('back').onclick=()=>{
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
  p.innerHTML='<div class="toolbar"><strong>Utenti</strong></div>'+
    people.map(x=>'<button class="person" data-id="'+esc(x.id)+'"><strong>'+esc(x.full_name)+'</strong><br><small>'+
      esc(x.phone)+' · '+(x.status==='pending'?'NUOVA RICHIESTA':esc(x.status))+'</small>'+
      (x.lastMessage?'<span class="chat-preview">'+
        esc((x.lastMessage.body||('📎 '+(x.lastMessage.file_name||'Allegato'))).slice(0,90))+
        '</span>':'')+
      (x.status==='pending'?'<br><span data-approve="'+esc(x.id)+'">✓ Approva</span> <span data-deny="'+esc(x.id)+'">✕ Rifiuta</span>':'')+
      '</button>').join('');
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
      selected=id;messageRequest++;
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
    '<button type="button" id="clearChatAction">Cancella chat</button>'+
    '<button type="button" class="danger" id="deleteUserAction">Elimina utente</button>'+
    '<button type="button" class="secondary" id="cancelChatAction">Annulla</button>'+
    '<p id="actionStatus" class="small"></p></div>';
  el.appendChild(modal);
  const close=()=>modal.remove();
  modal.onclick=event=>{if(event.target===modal)close()};
  document.getElementById('cancelChatAction').onclick=close;
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
      statusNode.textContent='Rimozione degli allegati in corso...';
      await deleteConversationFiles(user.id);
      statusNode.textContent=deleteUser?'Eliminazione account in corso...':'Cancellazione chat in corso...';
      const {error}=await db.rpc('freept_admin_delete_conversation',{
        p_user_id:user.id,p_delete_user:deleteUser
      });
      if(error)throw error;
      close();
      if(selected===user.id){
        selected=null;messageRequest++;
        document.getElementById('chat')?.classList.add('off');
        document.getElementById('people')?.classList.remove('off');
      }
      await listPeople();renderPeople();
    }catch(e){
      statusNode.textContent='Operazione non completata: '+friendly(e)+
        '. Alcuni allegati potrebbero essere stati rimossi; riprova solo dopo aver verificato.';
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

async function showMessages(scroll=true){if(!selected)return;const requestedUser=selected, requestId=++messageRequest;let query=db.from('messages').select('id,user_id,sender_id,body,file_path,file_name,created_at').eq('user_id',requestedUser).order('created_at',{ascending:false}).limit(200);const {data,error}=await query;if(requestId!==messageRequest || requestedUser!==selected)return;if(error){status(friendly(error),true);return}messages=(data||[]).reverse();const feed=document.getElementById('feed');if(!feed)return;const nearEnd=feed.scrollHeight-feed.scrollTop-feed.clientHeight<100;feed.innerHTML=messages.map(m=>'<article class="bubble '+(m.sender_id===me.id?'mine':'other')+'">'+(m.body?esc(m.body):'')+(m.file_path?'<a href="#" class="filelink" data-file="'+esc(m.file_path)+'">📎 '+esc(m.file_name||'Allegato')+'</a>':'')+'<small>'+new Date(m.created_at).toLocaleString('it-IT')+'</small></article>').join('');if(profile?.role!=='admin'){
  const queue=document.getElementById('queued');
  if(queue){
    const last=messages[messages.length-1];
    const awaiting=last && last.sender_id===me.id;
    queue.textContent=awaiting?'Richiesta in elaborazione… Attendere.':'';
    queue.classList.toggle('processing',!!awaiting);
  }
} feed.querySelectorAll('[data-file]').forEach(a=>a.onclick=async ev=>{ev.preventDefault();const {data,error}=await db.storage.from('attachments').createSignedUrl(a.dataset.file,60);if(error){status(friendly(error),true);return}window.open(data.signedUrl,'_blank','noopener')});if(scroll||nearEnd)feed.scrollTop=feed.scrollHeight}
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
  const storageUrl=URL.includes('.supabase.co')
    ? URL.replace('.supabase.co','.storage.supabase.co') : URL;
  const endpoint=storageUrl.replace(/\/$/,'')+'/storage/v1/upload/resumable';
  await new Promise((resolve,reject)=>{
    const upload=new tus.Upload(file,{
      endpoint,
      headers:{authorization:'Bearer '+token,apikey:KEY},
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
  if(document.visibilityState==='hidden'&&profile?.role==='admin'&&Capacitor.isNativePlatform()&&!filePickerActive){
    closeAdminOverlays();
    adminUnlocked=false;
    if(sub){db.removeChannel(sub);sub=null}
    selected=null;messageRequest++;
    el.innerHTML='<div class="shell">'+heading('FreePT')+'<main class="panel"><h2>Area amministratore bloccata</h2><p>Riapri FreePT per sbloccare con l’impronta.</p></main></div>';
  }
});
boot();
// Polling leggero quando l'app è in primo piano: recupera anche eventi realtime persi.
setInterval(async () => {
  if(document.visibilityState!=='visible' || !me || profile?.status!=='approved' || !selected || fetchingMessages)return;
  fetchingMessages=true;
  try{await showMessages(false)}finally{fetchingMessages=false}
}, 6000);
setInterval(async () => {
  if(document.visibilityState!=='visible' || !me || !profile) return;
  try {
    if(profile.status==='pending'){
      await loadProfile();
      if(profile.status==='approved') await renderWorkspace(); else if(profile.status==='blocked') requestScreen(true);
    } else if(profile.status==='approved' && profile.role==='admin'){
      await listPeople();
      renderPeople();
    }
  } catch(e){ status(friendly(e),true) }
}, 20000);
