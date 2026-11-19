import {config} from '/test/config.mjs';
import {derSignature,fixtureBytes} from '/test/protocol.mjs';
const $=id=>document.getElementById(id),encoder=new TextEncoder();
const sessions=new Map();let running=false;
const random=n=>crypto.getRandomValues(new Uint8Array(n));
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const hash=async value=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value==='string'?encoder.encode(value):value)));
const b64=bytes=>{let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s);};
const ready=()=>{$('run').disabled=running||!sessions.has('admin')||!sessions.has('user')||!$('fixtures').checked;};
$('fixtures').addEventListener('change',ready);
for(const kind of ['admin','user'])$(kind).addEventListener('submit',async event=>{
 event.preventDefault();if(running)return;
 const form=event.currentTarget,button=form.querySelector('button');button.disabled=true;sessions.delete(kind);ready();
 try{
  const email=form.elements.email.value.trim(),password=form.elements.password.value;
  const pending=fetch(config.supabase+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:config.publishable,'content-type':'application/json'},body:JSON.stringify({email,password}),credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(30000)});
  form.elements.password.value='';
  const r=await pending;if(!r.ok)throw Error('Login non riuscito. Verificare le credenziali TEST senza inserirle in chat.');
  const data=await r.json(),token=data.access_token;
  if(typeof token!=='string'||!data.user?.id||data.user.is_anonymous)throw Error('È richiesto un account TEST non anonimo.');
  const headers={apikey:config.publishable,authorization:'Bearer '+token};
  const u=await fetch(config.supabase+'/auth/v1/user',{headers,credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(30000)});
  if(!u.ok)throw Error('Sessione non verificata da Supabase Auth.');
  const verified=await u.json();if(verified.id!==data.user.id)throw Error('Identità Auth non coerente.');
  const p=await fetch(config.supabase+'/rest/v1/profiles?select=id,role,status&id=eq.'+encodeURIComponent(verified.id),{headers,credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(30000)});
  if(!p.ok)throw Error('Profilo TEST non leggibile con questa sessione.');
  const rows=await p.json();if(rows.length!==1||rows[0].id!==verified.id||rows[0].role!==(kind==='admin'?'admin':'user')||rows[0].status!=='approved')throw Error('Profilo TEST non approvato o ruolo non corretto. Nessuna modifica eseguita.');
  sessions.set(kind,{token,expires:Date.now()+Math.min(Number(data.expires_in)||0,1800)*1000});
  $(kind+'-status').textContent='Autenticato TEST: ruolo e stato approvato verificati.';form.elements.email.value='';
 }catch(e){$(kind+'-status').textContent=e.message;}
 finally{form.elements.password.value='';button.disabled=false;ready();}
});
$('clear').addEventListener('click',()=>{if(running)return;sessions.clear();for(const kind of ['admin','user']){$(kind).reset();$(kind+'-status').textContent='Non autenticato';}ready();});
$('run').addEventListener('click',async()=>{
 if($('run').disabled)return;running=true;ready();$('clear').disabled=true;
 const report={timestamp:new Date().toISOString(),level:'HTTPS + Supabase Auth real + browser WebCrypto (not Android)',checks:[],completeEndToEnd:false,deviceId:crypto.randomUUID()};
 const show=()=>{$('results').textContent=JSON.stringify(report,null,2);};
 const check=(name,condition)=>{if(!condition)throw Error(name);report.checks.push({name,result:'PASS'});show();};
 const post=async(action,body,token)=>{
  const r=await fetch('/bridge/bootstrap/'+action,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body),credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(55000)});
  return {status:r.status,body:await r.json()};
 };
 let started=false,bound=false,revoked=false,envelope;
 try{
  const admin=sessions.get('admin'),user=sessions.get('user');
  check('Entrambe le sessioni TEST valide',admin?.expires>Date.now()&&user?.expires>Date.now());
  const keys=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
  const publicKey=b64(new Uint8Array(await crypto.subtle.exportKey('spki',keys.publicKey))),pairCode=hex(random(6));
  envelope=async(action,data={})=>{
   const e={deviceId:report.deviceId,timestamp:Date.now(),nonce:hex(random(16)),payload:JSON.stringify(data)};
   const message=['freept-bootstrap-v1',action,e.deviceId,String(e.timestamp),e.nonce,e.payload].join('\n');
   e.signature=b64(derSignature(new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},keys.privateKey,encoder.encode(message)))));return e;
  };
  const initial=await envelope('start',{publicKey,pairCode,consent:true});
  let r=await post('start',initial);check('Identità tecnica pending prima del profilo',r.status===200&&r.body.state==='pending');started=true;
  r=await post('approve',{pairCode},user.token);check('Utente personale non può approvare',r.status===403);
  const wrong=(pairCode[0]==='0'?'1':'0')+pairCode.slice(1);
  r=await post('approve',{pairCode:wrong},admin.token);check('Codice errato negato ad admin autentico',r.status===403);
  r=await post('approve',{pairCode},admin.token);check('Approvazione amministratore Auth reale',r.status===200&&r.body.approved===true&&r.body.deviceId===report.deviceId);
  r=await post('approve',{pairCode},admin.token);check('Codice approvazione monouso',r.status===403);
  let job,all=new Uint8Array(300000);
  for(let i=0;i<2;i++){
   r=await post('poll',await envelope('poll'));job=r.body.job;
   check('Job sintetico autorizzato '+(i+1),r.status===200&&job?.operation==='diagnostic'&&job.size===300000&&job.offset===(i?262144:0)&&job.length===(i?37856:262144));
   const bytes=fixtureBytes(job.challenge,job.offset,job.length);all.set(bytes,job.offset);
   if(i===0){const bad=bytes.slice();bad[0]^=1;r=await post('chunk',await envelope('chunk',{offset:0,base64:b64(bad)}));check('Chunk corrotto negato',r.status===400);}
   const chunk=await envelope('chunk',{offset:job.offset,base64:b64(bytes)});
   r=await post('chunk',chunk);check('Ricezione chunk '+(i+1),r.status===200&&r.body.received===job.offset+job.length);
   r=await post('chunk',chunk);check('Anti-replay chunk '+(i+1),r.status===403);
  }
  r=await post('status',await envelope('status'));const digest=await hash(all);
  check('300000 byte e SHA256 verificati dal server',r.status===200&&r.body.state==='verified'&&r.body.sha256===digest);report.bytes=300000;report.sha256=digest;
  const deviceSecret=hex(random(32));
  r=await post('claim',await envelope('claim',{deviceSecret,accountProof:await hash('wrong-session')}),user.token);check('Sostituzione token personale negata',r.status===403);
  r=await post('claim',await envelope('claim',{deviceSecret,accountProof:await hash(user.token)}),user.token);
  check('Associazione utente TEST approvato con Auth reale',r.status===200&&r.body.bound===true&&r.body.deviceId===report.deviceId);bound=true;
  r=await post('claim',await envelope('claim',{deviceSecret,accountProof:await hash(user.token)}),user.token);check('Retry claim idempotente',r.status===200&&r.body.bound===true);
  r=await post('status',await envelope('status'));check('Stato associato verificato',r.status===200&&r.body.state==='bound');
  r=await post('revoke',{deviceId:report.deviceId},admin.token);check('Revoca amministratore autenticato',r.status===200&&r.body.revoked===true);revoked=true;
  r=await post('status',await envelope('status'));check('Revoca applicata al dispositivo',r.status===403);
  report.completeEndToEnd=true;
 }catch(e){report.failure=e.message;}
 finally{
  if(started&&!revoked){try{const r=bound?await post('revoke',{deviceId:report.deviceId},sessions.get('admin')?.token):await post('cancel',await envelope('cancel'));report.cleanup=r.status===200?'revoked_or_cancelled':'FAILED';}catch{report.cleanup='FAILED';}}
  report.notExecuted=['Android Keystore','Oppo physical SAF/background','Approval expiry by actual elapsed time'];show();running=false;$('clear').disabled=false;ready();
 }
});
