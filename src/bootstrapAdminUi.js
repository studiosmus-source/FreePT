/** Admin pairing uses a code read on the physical consenting device. */
export function mountBootstrapAdmin({host,db,baseUrl,isAuthorized,fetchImpl=fetch}={}){
 if(!host||!baseUrl)return;
 const box=document.createElement('section');
 box.innerHTML='<form class="form" autocomplete="off"><label>Codice dispositivo<input name="pairCode" required pattern="[0-9A-Fa-f]{12}" maxlength="12" autocomplete="off"></label><button type="submit">Autorizza dispositivo</button></form><p role="status"></p><form class="form" autocomplete="off"><label>Dispositivo da revocare<input name="deviceId" required maxlength="36"></label><button type="submit">Revoca dispositivo</button></form>';
 host.appendChild(box);
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
