import { registerPlugin } from '@capacitor/core';
const Native = registerPlugin('FreePTBridge');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let currentService = null;
function uuid() {
  const key = 'freept_bridge_device_v2';
  let value = localStorage.getItem(key);
  if (!value) { value = crypto.randomUUID(); localStorage.setItem(key,value); }
  return value;
}
export async function activateBridge(db, userId) {
  const permission = await Native.chooseFolder();
  if (!permission.authorized) throw Error('Cartella non autorizzata');
  const device_id = uuid();
  const {error} = await db.from('bridge_devices').upsert({
    user_id:userId,device_id,display_name:'Telefono Android',enabled:true,granted_at:new Date().toISOString(),
    updated_at:new Date().toISOString()
  },{onConflict:'user_id'});
  if(error) throw Error('Registrazione Bridge fallita: '+error.message);
  return device_id;
}
export async function deactivateBridge(db,userId) {
  const {error} = await db.from('bridge_devices').update({enabled:false,updated_at:new Date().toISOString()}).eq('user_id',userId);
  if(error) throw error;
  await Native.revoke();
}
async function serviceOnce(db,userId) {
  const grant=await Native.status();
  if(!grant.authorized) return;
  const {data:devices,error:deviceError}=await db.from('bridge_devices').select('device_id,enabled').eq('user_id',userId).maybeSingle();
  if(deviceError || !devices?.enabled || devices.device_id!==uuid()) return;
  const {data:jobs,error}=await db.from('bridge_requests')
    .select('id,device_id,request_type,resource_id,chunk_offset,expires_at')
    .eq('user_id',userId).eq('status','pending').order('created_at',{ascending:true}).limit(3);
  if(error) return;
  for(const job of jobs || []) {
    if(job.device_id!==devices.device_id || Date.parse(job.expires_at)<=Date.now()) continue;
    try {
      const output = job.request_type==='list'
        ? await Native.list({resourceId:job.resource_id || ''})
        : await Native.readChunk({resourceId:job.resource_id,offset:Number(job.chunk_offset)});
      const {error:writeError}=await db.from('bridge_requests').update({status:'done',result:output}).eq('id',job.id).eq('status','pending');
      if(writeError) console.warn('Bridge reply not saved',writeError.message);
    } catch (e) {
      await db.from('bridge_requests').update({status:'error',result:{message:String(e?.message||'Errore lettura').slice(0,300)}}).eq('id',job.id).eq('status','pending');
    }
  }
}
export function startBridgeService(db,userId) {
  if(currentService) currentService.stop();
  let stopped=false,active=false;
  const timer=setInterval(async()=>{
    if(stopped||active||document.visibilityState!=='visible')return;
    active=true;
    try{await serviceOnce(db,userId)}catch(e){console.warn('Bridge service',e)}finally{active=false}
  },3000);
  currentService={stop(){stopped=true;clearInterval(timer)}};
  return currentService;
}
async function request(db, device, type, resourceId=null, offset=null) {
  const {data,error}=await db.from('bridge_requests').insert({
    user_id:device.user_id,device_id:device.device_id,request_type:type,resource_id:resourceId,chunk_offset:offset
  }).select('id').single();
  if(error)throw Error('Impossibile inviare richiesta Bridge: '+error.message);
  for(let tries=0;tries<25;tries++) {
    await sleep(2500);
    const res=await db.from('bridge_requests').select('status,result,expires_at').eq('id',data.id).maybeSingle();
    if(res.error)throw res.error;
    if(res.data?.status==='done')return res.data.result;
    if(res.data?.status==='error')throw Error(res.data.result?.message||'Errore remoto');
    if(!res.data || Date.parse(res.data.expires_at)<=Date.now())break;
  }
  throw Error('Telefono non raggiungibile: aprire FreePT sul dispositivo remoto');
}
function screen(title, body, back) {
  const target=document.getElementById('app');
  target.innerHTML='<div class="shell"><header class="top"><h1>FreePT · Bridge</h1><button id="bridgeBack">Indietro</button></header>'+
    '<main class="bridge-panel"><h2>'+esc(title)+'</h2>'+body+'<p class="small" id="bridgeStatus"></p></main></div>';
  document.getElementById('bridgeBack').onclick=back;
}
const show = (msg,bad=false) => {
  const node=document.getElementById('bridgeStatus');
  if(node){node.textContent=msg;node.className=bad?'error':'small'}
};
export async function showActivation(db,userId,back) {
  screen('Attivazione file',
    '<p>Autorizza una cartella e le sue sottocartelle. Solo i file presenti nella cartella scelta saranno consultabili dall’amministratore quando FreePT è aperta.</p>'+
    '<button id="bridgeActivate">Autorizza file</button> <button id="bridgeDisable">Disattiva accesso</button>',back);
  document.getElementById('bridgeActivate').onclick=async()=>{
    show('Apertura autorizzazione Android...');
    try{await activateBridge(db,userId);startBridgeService(db,userId);show('Telefono registrato. Bridge attivo.');}
    catch(e){show(e.message,true)}
  };
  document.getElementById('bridgeDisable').onclick=async()=>{
    if(!confirm('Revocare accesso ai file di questo telefono?'))return;
    try{await deactivateBridge(db,userId);show('Bridge disattivato');}
    catch(e){show(e.message,true)}
  };
  try{
    const g=await Native.status();
    if(g.authorized)show('Permesso Android già presente. Se la registrazione non è riuscita, premi Autorizza file.');
  }catch(e){show('Bridge disponibile solo nell’APK Android.',true)}
}
function filename(name) { return (name||'file').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,100); }
async function download(db,device,file) {
  if(file.size != null && file.size > 25*1024*1024) throw Error('Per sicurezza, questa versione limita i download a 25 MB');
  const blocks=[];
  let offset=0;
  for(let i=0;i<550;i++) {
    const result=await request(db,device,'chunk',file.id,offset);
    const data=atob(result.base64||'');
    const bytes=Uint8Array.from(data,c=>c.charCodeAt(0));
    if(bytes.length!==Number(result.length) || bytes.length>49152)throw Error('Blocco file non valido');
    blocks.push(bytes);offset+=bytes.length;
    show('Download '+file.name+': '+Math.round(offset/1024)+' KB');
    if(result.eof || bytes.length===0)break;
    if(i===549)throw Error('Limite blocchi superato');
  }
  const blob=new Blob(blocks,{type:file.mime||'application/octet-stream'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=filename(file.name);document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
export async function showAdminExplorer(db,userId,name,back) {
  screen('File e cartelle · '+name,'<p id="bridgeDevices">Ricerca telefono autorizzato...</p><div id="bridgeEntries"></div>',back);
  const deviceNode=document.getElementById('bridgeDevices');
  const entriesNode=document.getElementById('bridgeEntries');
  let device;
  try{
    const {data,error}=await db.from('bridge_devices').select('user_id,device_id,enabled').eq('user_id',userId).maybeSingle();
    if(error)throw error;
    if(!data?.enabled){deviceNode.textContent='Nessun telefono Bridge autorizzato per questa persona.';return}
    device=data;
    deviceNode.textContent='Telefono associato. La persona deve tenere FreePT aperta durante l’accesso.';
  }catch(e){show(e.message,true);return}
  const stack=[];
  async function open(id,label) {
    show('Caricamento '+label+'...');
    try{
      const listing=await request(db,device,'list',id);
      entriesNode.innerHTML='<div class="bridge-toolbar"><button id="bridgeUp" '+(stack.length===0?'disabled':'')+'>Cartella precedente</button><strong>'+esc(label)+'</strong></div>'+
        (listing.entries||[]).map((entry,i)=>
          '<button class="bridge-entry" data-index="'+i+'">'+(entry.directory?'📁 ':'📄 ')+esc(entry.name)+
          (entry.directory?'':' · '+(entry.size == null?'':Math.round(entry.size/1024)+' KB'))+'</button>').join('');
      document.getElementById('bridgeUp').onclick=()=>{const previous=stack.pop();if(previous)open(previous.id,previous.label)};
      entriesNode.querySelectorAll('[data-index]').forEach(button=>button.onclick=async()=>{
        const entry=listing.entries[Number(button.dataset.index)];
        if(entry.directory) {stack.push({id,label});await open(entry.id,entry.name)}
        else {try{await download(db,device,entry);show('Download richiesto: '+entry.name)}catch(e){show(e.message,true)}}
      });
      show((listing.entries||[]).length+' elementi');
    }catch(e){show(e.message,true)}
  }
  await open(null,'Cartella autorizzata');
}
