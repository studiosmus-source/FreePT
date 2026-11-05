import { createClient } from '@supabase/supabase-js';
import './style.css';

const URL = import.meta.env.VITE_SUPABASE_URL || 'https://cpopqsvzzxfjgnlawlvc.supabase.co';
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_Q74UCgQUXO6f_7vZhXcbyg_2KRl2OSN';
const db = createClient(URL, KEY, { auth: { persistSession: true, autoRefreshToken: true } });
const el = document.getElementById('app');
let me = null, profile = null, people = [], selected = null, messages = [], sub = null, busy = false;
const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const friendly = e => e?.message || 'Operazione non riuscita';
function status(msg, bad=false){ const n=document.getElementById('status'); if(n){n.textContent=msg;n.className=bad?'error':'small'} }
function phoneNorm(s){ return s.replace(/[\s().-]/g,''); }
function syntheticEmail(phone){ return 'u'+phone.replace(/\D/g,'')+'@users.freept.invalid'; }
function heading(t,extra=''){return '<header class="top"><h1>'+esc(t)+'</h1>'+extra+'</header>'}
function authScreen(signup=false){ el.innerHTML='<div class="shell">'+heading('FreePT')+'<main class="panel"><h2>'+(signup?'Richiedi iscrizione':'Accedi')+'</h2><form class="form" id="auth">'+(signup?'<input name="name" placeholder="Nome e cognome" maxlength="80" required autocomplete="name"/>':'')+'<input name="phone" type="tel" placeholder="Numero di telefono (+39...)" required autocomplete="tel"/><input name="pass" type="password" minlength="8" placeholder="Password (almeno 8 caratteri)" required autocomplete="'+(signup?'new-password':'current-password')+'"/><button>'+(signup?'Invia richiesta':'Entra')+'</button></form><p id="status" class="small"></p><button id="toggle" type="button">'+(signup?'Ho già un account':'Nuova iscrizione')+'</button></main></div>';document.getElementById('toggle').onclick=()=>authScreen(!signup); document.getElementById('auth').onsubmit=async ev=>{ev.preventDefault();const f=new FormData(ev.target),phone=phoneNorm(f.get('phone'));if(!/^\+[1-9]\d{7,14}$/.test(phone)){status('Inserisci il numero con prefisso internazionale, ad esempio +39...',true);return}const pass=String(f.get('pass')),email=syntheticEmail(phone);status('Operazione in corso...');try{let result;if(signup){let name=String(f.get('name')).trim();if(name.length<2)throw Error('Inserisci il nome');result=await db.auth.signUp({email,password:pass,options:{data:{full_name:name,phone}}})}else{result=await db.auth.signInWithPassword({email,password:pass})}if(result.error)throw result.error; if(signup){status('Richiesta inviata. Attendi l’approvazione.'); await db.auth.signOut()} else await boot()}catch(e){status(friendly(e),true)}}}
async function loadProfile(){const {data,error}=await db.from('profiles').select('id,full_name,phone,role,status').eq('id',me.id).single();if(error)throw error;profile=data}
async function boot(){ const {data:{user}}=await db.auth.getUser();me=user;if(!me){profile=null;authScreen();return}try{await loadProfile();if(profile.status==='blocked'){await db.auth.signOut();el.innerHTML='<div class="panel">Accesso disabilitato.</div>';return}if(profile.status!=='approved'){el.innerHTML='<div class="shell">'+heading('FreePT','<button id="logout">Esci</button>')+'<div class="notice">Registrazione ricevuta. In attesa di approvazione.</div></div>';document.getElementById('logout').onclick=logout;return}await renderWorkspace()}catch(e){el.innerHTML='<div class="panel"><h2>Configurazione non completata</h2><p>'+esc(friendly(e))+'</p><button id="retry">Riprova</button></div>';document.getElementById('retry').onclick=boot}}
async function logout(){if(sub){db.removeChannel(sub);sub=null}await db.auth.signOut();me=null;profile=null;selected=null;authScreen()}
async function listPeople(){const {data,error}=await db.from('profiles').select('id,full_name,phone,status,role').neq('role','admin').order('created_at',{ascending:false});if(error)throw error;people=data||[]}
async function renderWorkspace(){if(sub){db.removeChannel(sub);sub=null}if(profile.role==='admin')await listPeople();else selected=me.id;renderLayout();if(selected)await showMessages();sub=db.channel('freept-sync').on('postgres_changes',{event:'*',schema:'public',table:'messages'},async()=>{if(selected)await showMessages(false)}).on('postgres_changes',{event:'*',schema:'public',table:'profiles'},async()=>{if(profile.role==='admin'){await listPeople();renderPeople()}}).subscribe();document.addEventListener('visibilitychange',refreshOnVisible,{once:true})}
async function refreshOnVisible(){
  if(document.visibilityState==='visible'){
    try {
      if(me && profile?.status==='pending'){
        await loadProfile();
        if(profile.status==='approved'){await renderWorkspace();return}
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
function renderLayout(){let admin=profile.role==='admin';el.innerHTML='<div class="shell">'+heading('FreePT', '<button id="logout">Esci</button>')+'<div class="workspace">'+(admin?'<aside id="people" class="people"></aside>':'')+'<section id="chat" class="chat '+(admin?'off':'')+'"><div class="toolbar">'+(admin?'<button class="mobileBack" id="back">‹</button>':'')+'<strong class="grow" id="chatTitle">Servizio</strong></div><div class="feed" id="feed"></div><div class="hint" id="queued"></div><form class="compose" id="send"><label class="attach" for="file">📎</label><input type="file" id="file" name="file"/><textarea name="text" placeholder="Scrivi un messaggio" maxlength="10000"></textarea><button id="sendBtn">Invia</button></form><p id="status" class="hint"></p></section></div></div>';document.getElementById('logout').onclick=logout;if(admin){renderPeople();document.getElementById('back').onclick=()=>{document.getElementById('chat').classList.add('off');document.getElementById('people').classList.remove('off')}} document.getElementById('send').onsubmit=send}
function renderPeople(){const p=document.getElementById('people');if(!p)return;p.innerHTML='<div class="toolbar"><strong>Utenti</strong></div>'+people.map(x=>'<button class="person" data-id="'+esc(x.id)+'"><strong>'+esc(x.full_name)+'</strong><br><small>'+esc(x.phone)+' · '+esc(x.status)+'</small>'+(x.status==='pending'?'<br><span data-approve="'+esc(x.id)+'">✓ Approva</span>':'')+'</button>').join('');p.querySelectorAll('[data-id]').forEach(b=>b.onclick=async ev=>{const id=b.dataset.id;if(ev.target.dataset.approve){ev.stopPropagation();if(!confirm('Approvare questo utente?'))return;let {error}=await db.from('profiles').update({status:'approved'}).eq('id',id);if(error)alert(friendly(error));else{await listPeople();renderPeople()}return}selected=id;document.getElementById('chat').classList.remove('off');p.classList.add('off');document.getElementById('chatTitle').textContent=people.find(x=>x.id===id)?.full_name||'Chat';await showMessages()})}
async function showMessages(scroll=true){if(!selected)return;let query=db.from('messages').select('id,user_id,sender_id,body,file_path,file_name,created_at').eq('user_id',selected).order('created_at',{ascending:true}).limit(200);const {data,error}=await query;if(error){status(friendly(error),true);return}messages=data||[];const feed=document.getElementById('feed');if(!feed)return;const nearEnd=feed.scrollHeight-feed.scrollTop-feed.clientHeight<100;feed.innerHTML=messages.map(m=>'<article class="bubble '+(m.sender_id===me.id?'mine':'other')+'">'+(m.body?esc(m.body):'')+(m.file_path?'<a href="#" class="filelink" data-file="'+esc(m.file_path)+'">📎 '+esc(m.file_name||'Allegato')+'</a>':'')+'<small>'+new Date(m.created_at).toLocaleString('it-IT')+'</small></article>').join('');feed.querySelectorAll('[data-file]').forEach(a=>a.onclick=async ev=>{ev.preventDefault();const {data,error}=await db.storage.from('attachments').createSignedUrl(a.dataset.file,60);if(error){status(friendly(error),true);return}window.open(data.signedUrl,'_blank','noopener')});if(scroll||nearEnd)feed.scrollTop=feed.scrollHeight}
async function send(ev){ev.preventDefault();if(busy||!selected)return;const form=ev.target,body=form.elements.text.value.trim(),file=form.elements.file.files[0];if(!body&&!file)return;if(file&&file.size>25*1024*1024){status('Allegato troppo grande: massimo 25 MB',true);return}busy=true;document.getElementById('sendBtn').disabled=true;status('Invio in corso...');let path=null;try{if(file){const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,120)||'file';path=selected+'/'+crypto.randomUUID()+'/'+safe;const upload=await db.storage.from('attachments').upload(path,file,{contentType:file.type||'application/octet-stream',upsert:false});if(upload.error)throw upload.error}const id=crypto.randomUUID();const payload={id,user_id:selected,sender_id:me.id,body,file_path:path,file_name:file?.name||null};const {error}=await db.from('messages').insert(payload);if(error)throw error;form.reset();status('Messaggio ricevuto dal server.');await showMessages()}catch(e){status('Invio non completato: '+friendly(e),true)}finally{busy=false;document.getElementById('sendBtn').disabled=false}}
boot();
setInterval(async () => {
  if(document.visibilityState!=='visible' || !me || !profile) return;
  try {
    if(profile.status==='pending'){
      await loadProfile();
      if(profile.status==='approved') await renderWorkspace();
    } else if(profile.status==='approved' && profile.role==='admin'){
      await listPeople();
      renderPeople();
    }
  } catch(e){ status(friendly(e),true) }
}, 20000);
