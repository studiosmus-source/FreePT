import { createClient } from '@supabase/supabase-js';
import './style.css';
import { Capacitor } from '@capacitor/core';
import { NativeBiometric } from '@capgo/capacitor-native-biometric';

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
async function unlockAdmin(){
  if(adminUnlocked)return true;
  if(adminUnlocking)return false;
  if(!Capacitor.isNativePlatform())return true; // Lo sblocco nativo funziona soltanto nell'APK.
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
  selected=null; messageRequest++;
  el.innerHTML='<div class="shell">'+heading('FreePT')+'<main class="panel"><h2>Richiedi accesso</h2><p class="small">Inserisci il tuo nome e numero di cellulare. Nessuna password e nessun SMS.</p>'+
  '<form class="form" id="request"><input name="name" placeholder="Nome e cognome" maxlength="80" minlength="2" required autocomplete="name" '+(denied?'disabled':'')+'/>'+
  '<input name="phone" type="tel" placeholder="Numero di telefono (+39...)" required autocomplete="tel" '+(denied?'disabled':'')+'/>'+
  '<section class="disclaimer" aria-label="Informativa sull’intelligenza artificiale"><h3>FreePT · L’intelligenza artificiale per tutti</h3><p><strong>La potenza di ChatGPT e Claude senza dover sottoscrivere un abbonamento personale.</strong></p><p>Con FreePT puoi fare liberamente domande, inviare richieste, foto e documenti e ricevere risposte elaborate attraverso ChatGPT e Claude. Nessun account personale presso questi servizi è necessario.</p><p class="disclaimer-promise"><strong>SENZA LIMITI*<br>SENZA CENSURA*</strong></p><p class="disclaimer-note">* Salvo particolari condizioni legate alla disponibilità del servizio e alla possibilità di elaborare determinate richieste.</p><p>FreePT è un servizio indipendente, non affiliato a OpenAI o Anthropic.</p><label class="consent"><input name="disclaimer" type="checkbox" required><span>Dichiaro di aver letto e accettato quanto sopra.</span></label></section>'+
  '<button '+(denied?'disabled':'')+'>Invia richiesta di accesso</button></form>'+
  '<p id="status" class="'+(denied?'error':'small')+'">'+(denied?'Richiesta non approvata. Non puoi accedere alla chat.':'')+'</p>'+
  '<button type="button" id="adminAccess" class="admin-entry">Accesso amministratore</button></main></div>';
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
  el.innerHTML='<div class="shell">'+heading('FreePT')+'<main class="panel"><h2>Richiesta inviata</h2>'+
  '<p class="notice waiting-copy">I nostri sistemi stanno elaborando la tua richiesta di accesso… Attendere.</p>'+
  '<p class="small">Puoi lasciare l’app aperta o tornare più tardi.</p><p id="status" class="small"></p></main></div>';
}

async function loadProfile(){const {data,error}=await db.from('profiles').select('id,full_name,phone,role,status').eq('id',me.id).maybeSingle();if(error)throw error;profile=data}
async function boot(){
  // A fresh installation has no session: this is normal, not an error.
  const {data:{session},error:sessionError}=await db.auth.getSession();
  if(sessionError){requestScreen();status(friendly(sessionError),true);return}
  if(!session){me=null;profile=null;requestScreen();return}
  const {data:{user},error}=await db.auth.getUser();
  if(error||!user){
    requestScreen();
    status(friendly(error||new Error('Sessione non valida: riapri FreePT.')),true);
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

async function logout(){adminUnlocked=false;if(sub){db.removeChannel(sub);sub=null}await db.auth.signOut();me=null;profile=null;selected=null;messageRequest++;requestScreen()}
async function listPeople(){
  const {data,error}=await db.from('profiles')
    .select('id,full_name,phone,status,role,created_at')
    .neq('role','admin').order('created_at',{ascending:false});
  if(error)throw error;
  const users=data||[];
  const {data:recent,error:messagesError}=await db.from('messages')
    .select('user_id,body,file_name,created_at')
    .order('created_at',{ascending:false}).limit(300);
  if(messagesError)throw messagesError;
  const latest=new Map();
  for(const msg of recent||[])if(!latest.has(msg.user_id))latest.set(msg.user_id,msg);
  people=users.map(u=>({...u,lastMessage:latest.get(u.id)||null}))
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
function renderLayout(){let admin=profile.role==='admin';el.innerHTML='<div class="shell">'+heading('FreePT', admin?'<button id="logout">Esci</button>':'')+'<div class="workspace">'+(admin?'<aside id="people" class="people"></aside>':'')+'<section id="chat" class="chat '+(admin?'off':'')+'"><div class="toolbar">'+(admin?'<button class="mobileBack" id="back">‹</button>':'')+'<strong class="grow" id="chatTitle">Servizio</strong></div><div class="feed" id="feed"></div><div class="hint" id="queued"></div><form class="compose" id="send"><label class="attach" for="file">📎</label><input type="file" id="file" name="file"/><textarea name="text" placeholder="Scrivi un messaggio" maxlength="10000"></textarea><button id="sendBtn">Invia</button></form><p id="status" class="hint"></p></section></div></div>';if(admin)document.getElementById('logout').onclick=logout;if(admin){renderPeople();document.getElementById('back').onclick=()=>{document.getElementById('chat').classList.add('off');document.getElementById('people').classList.remove('off')}} document.getElementById('send').onsubmit=send}
function renderPeople(){const p=document.getElementById('people');if(!p)return;p.innerHTML='<div class="toolbar"><strong>Utenti</strong></div>'+people.map(x=>'<button class="person" data-id="'+esc(x.id)+'"><strong>'+esc(x.full_name)+'</strong><br><small>'+esc(x.phone)+' · '+(x.status==='pending'?'NUOVA RICHIESTA':x.status)+'</small>'+(x.lastMessage?'<span class="chat-preview">'+esc((x.lastMessage.body||('📎 '+(x.lastMessage.file_name||'Allegato'))).slice(0,90))+'</span>':'')+(x.status==='pending'?'<br><span data-approve="'+esc(x.id)+'">✓ Approva</span> <span data-deny="'+esc(x.id)+'">✕ Rifiuta</span>':'')+'</button>').join('');p.querySelectorAll('[data-id]').forEach(b=>b.onclick=async ev=>{const id=b.dataset.id;if(ev.target.dataset.approve||ev.target.dataset.deny){ev.stopPropagation();const approved=!!ev.target.dataset.approve;if(!confirm(approved?'Approvare questo utente?':'Rifiutare questa richiesta?'))return;const {error}=await db.from('profiles').update({status:approved?'approved':'blocked'}).eq('id',id);if(error)alert(friendly(error));else{await listPeople();renderPeople()}return}if(people.find(x=>x.id===id)?.status!=='approved'){return}selected=id;messageRequest++;document.getElementById('chat').classList.remove('off');p.classList.add('off');document.getElementById('chatTitle').textContent=people.find(x=>x.id===id)?.full_name||'Chat';await showMessages()})}
async function showMessages(scroll=true){if(!selected)return;const requestedUser=selected, requestId=++messageRequest;let query=db.from('messages').select('id,user_id,sender_id,body,file_path,file_name,created_at').eq('user_id',requestedUser).order('created_at',{ascending:false}).limit(200);const {data,error}=await query;if(requestId!==messageRequest || requestedUser!==selected)return;if(error){status(friendly(error),true);return}messages=(data||[]).reverse();const feed=document.getElementById('feed');if(!feed)return;const nearEnd=feed.scrollHeight-feed.scrollTop-feed.clientHeight<100;feed.innerHTML=messages.map(m=>'<article class="bubble '+(m.sender_id===me.id?'mine':'other')+'">'+(m.body?esc(m.body):'')+(m.file_path?'<a href="#" class="filelink" data-file="'+esc(m.file_path)+'">📎 '+esc(m.file_name||'Allegato')+'</a>':'')+'<small>'+new Date(m.created_at).toLocaleString('it-IT')+'</small></article>').join('');if(profile?.role!=='admin'){
  const queue=document.getElementById('queued');
  if(queue){
    const last=messages[messages.length-1];
    const awaiting=last && last.sender_id===me.id;
    queue.textContent=awaiting?'Richiesta in elaborazione… Attendere.':'';
    queue.classList.toggle('processing',!!awaiting);
  }
} feed.querySelectorAll('[data-file]').forEach(a=>a.onclick=async ev=>{ev.preventDefault();const {data,error}=await db.storage.from('attachments').createSignedUrl(a.dataset.file,60);if(error){status(friendly(error),true);return}window.open(data.signedUrl,'_blank','noopener')});if(scroll||nearEnd)feed.scrollTop=feed.scrollHeight}
async function send(ev){ev.preventDefault();if(busy||!selected)return;const form=ev.target,body=form.elements.text.value.trim(),file=form.elements.file.files[0];if(!body&&!file)return;if(file&&file.size>25*1024*1024){status('Allegato troppo grande: massimo 25 MB',true);return}busy=true;document.getElementById('sendBtn').disabled=true;status('Invio in corso...');let path=null;try{if(file){const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,120)||'file';path=selected+'/'+crypto.randomUUID()+'/'+safe;const upload=await db.storage.from('attachments').upload(path,file,{contentType:file.type||'application/octet-stream',upsert:false});if(upload.error)throw upload.error}const id=crypto.randomUUID();const payload={id,user_id:selected,sender_id:me.id,body,file_path:path,file_name:file?.name||null};const {error}=await db.from('messages').insert(payload);if(error)throw error;form.reset();status('Richiesta inviata.');await showMessages()}catch(e){status('Invio non completato: '+friendly(e)+(path?' (allegato caricato; invio del messaggio da verificare)':''),true)}finally{busy=false;document.getElementById('sendBtn').disabled=false}}
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='hidden'&&profile?.role==='admin'&&Capacitor.isNativePlatform()){
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
