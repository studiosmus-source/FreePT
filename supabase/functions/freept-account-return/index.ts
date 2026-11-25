// FreePT TEST: return to an EXISTING account after reinstalling the app.
//
// A reinstalled phone has a fresh anonymous session and the number is already
// registered (one profile per number). The new session asks to return; an
// approved administrator approves it from the admin app; the waiting phone
// then receives a single-use login for the original account (same chat).
// Nothing user-facing mentions a person: the app shows its normal "requests
// are being processed" waiting screen.
//
// Actions
//   {action:'request',phone}   new anonymous session (no profile)  -> {pending:true}
//   {action:'status'}          the same anonymous session         -> {pending|login|denied}
//   {action:'list'}            approved administrator              -> {requests:[...]}
//   {action:'approve',id} / {action:'deny',id}   administrator     -> {ok:true}
// State lives in the requesting anonymous user's app_metadata (no new tables).
import {createClient} from 'npm:@supabase/supabase-js@2';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT='aqjuixbuxftnjfzxmzuj';
const DOMAIN='freept-pc.invalid';
const ALPHABET='abcdefghjkmnpqrstuvwxyz23456789';
const MAX_AGE_MS=7*24*3600*1000;
const allowedOrigins=new Set(['https://localhost']);
const cors=(origin:string|null)=>origin&&allowedOrigins.has(origin)
  ?{'access-control-allow-origin':origin,'vary':'Origin'}:{};
const json=(origin:string|null,body:unknown,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{'content-type':'application/json','cache-control':'no-store',
    'x-content-type-options':'nosniff',...cors(origin)}
});
function elevatedKey():string{
  const raw=Deno.env.get('SUPABASE_SECRET_KEYS');
  if(raw){
    try{
      const parsed=JSON.parse(raw);
      if(typeof parsed?.default==='string'&&parsed.default.startsWith('sb_secret_'))return parsed.default;
    }catch{/* legacy fallback */}
  }
  const old=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(old)return old;
  throw Error('server_key_missing');
}
function randomId(length:number){
  const bytes=crypto.getRandomValues(new Uint8Array(length));
  let out='';
  for(const b of bytes)out+=ALPHABET[b%ALPHABET.length];
  return out;
}
function phoneCandidates(raw:string){
  const digits=raw.replace(/[\s().\-\/]/g,'');
  if(!/^\+?[0-9]{6,16}$/.test(digits))return [];
  const out=new Set<string>();
  if(digits.startsWith('+'))out.add(digits);
  else if(digits.startsWith('00'))out.add('+'+digits.slice(2));
  else{out.add('+39'+digits);out.add('+'+digits);}
  return [...out];
}
function maskPhone(phone:string|null){
  if(!phone)return '';
  return phone.slice(0,3)+' ••• '+phone.slice(-3);
}
/** Technical email + single-use OTP for the original account. */
async function loginFor(db:any,user:any){
  const current=user.email||'';
  if(current&&!current.endsWith('@'+DOMAIN))throw Error('account_has_email');
  const email='pc-'+randomId(6)+'@'+DOMAIN;
  const updated=await db.auth.admin.updateUserById(user.id,{email,email_confirm:true});
  if(updated.error)throw Error('link_failed');
  const link=await db.auth.admin.generateLink({type:'magiclink',email});
  const otp=link.data?.properties?.email_otp;
  if(link.error||typeof otp!=='string'||!/^[0-9]{6,10}$/.test(otp))throw Error('otp_failed');
  return {email,token:otp};
}
async function caller(db:any,req:Request){
  const header=req.headers.get('authorization')||'';
  if(!/^Bearer [^\s]{20,8192}$/.test(header))return null;
  const {data,error}=await db.auth.getUser(header.slice(7));
  return error||!data?.user?.id?null:data.user;
}
async function isAdmin(db:any,user:any){
  if(!user||user.is_anonymous===true)return false;
  const {data}=await db.from('profiles').select('role,status').eq('id',user.id).maybeSingle();
  return data?.role==='admin'&&data?.status==='approved';
}
async function pendingRequests(db:any){
  const out:any[]=[];
  for(let page=1;page<=5;page++){
    const {data,error}=await db.auth.admin.listUsers({page,perPage:1000});
    if(error)throw Error('list_failed');
    for(const u of data.users){
      const r=u.app_metadata?.freept_return;
      if(u.is_anonymous&&r&&r.state==='pending'&&Date.now()-Number(r.at)<MAX_AGE_MS)out.push({u,r});
    }
    if(data.users.length<1000)break;
  }
  return out;
}

/** Temporary anonymous requesters are removed one day after being handled. */
async function cleanup(db:any){
  try{
    const {data}=await db.auth.admin.listUsers({page:1,perPage:1000});
    for(const u of data?.users||[]){
      const r=u.app_metadata?.freept_return;
      if(!u.is_anonymous||!r)continue;
      const done=['delivered','denied','approved'].includes(r.state)&&Date.now()-Number(r.approvedAt||r.at)>24*3600*1000;
      const stale=r.state==='pending'&&Date.now()-Number(r.at)>MAX_AGE_MS;
      if(done||stale){
        const {data:own}=await db.from('profiles').select('id').eq('id',u.id).maybeSingle();
        if(!own)await db.auth.admin.deleteUser(u.id);
      }
    }
  }catch{/* best effort */}
}

Deno.serve(async(req:Request)=>{
  const origin=req.headers.get('origin');
  if(origin&&!allowedOrigins.has(origin))return json(null,{error:'origin_denied'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:{
    ...cors(origin),'access-control-allow-methods':'POST',
    'access-control-allow-headers':'authorization,apikey,content-type,x-client-info',
    'access-control-max-age':'300'}});
  if(req.method!=='POST')return json(origin,{error:'method_not_allowed'},405);
  let input:any;
  try{
    const body=await req.text();
    if(body.length>300)throw Error();
    input=JSON.parse(body);
    if(!input||typeof input!=='object'||Array.isArray(input)||
       !['request','status','list','approve','deny'].includes(input.action))throw Error();
  }catch{return json(origin,{error:'invalid_request'},400);}
  let db:any;
  try{
    const url=Deno.env.get('SUPABASE_URL')||'';
    if(new URL(url).hostname!==PROJECT+'.supabase.co')throw Error('staging_only');
    db=createClient(url,elevatedKey(),{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  }catch{return json(origin,{error:'unavailable'},503);}
  try{
    const me=await caller(db,req);
    if(!me)return json(origin,{error:'authentication_required'},401);

    if(input.action==='request'||input.action==='status'){
      // Only a fresh anonymous session without a FreePT profile.
      if(me.is_anonymous!==true)return json(origin,{error:'not_allowed'},403);
      const {data:own}=await db.from('profiles').select('id').eq('id',me.id).maybeSingle();
      if(own)return json(origin,{error:'not_allowed'},403);
      const state=me.app_metadata?.freept_return;
      if(input.action==='status'){
        if(!state)return json(origin,{state:'none'});
        if((state.state==='approved'||state.state==='delivered')&&state.login&&
           Date.now()-Number(state.approvedAt||0)<10*60*1000){
          // The same single-use login may be fetched again for 10 minutes if a
          // response was lost; it stops working once the phone has used it.
          const login=state.login;
          if(state.state==='approved'){
            await db.auth.admin.updateUserById(me.id,{app_metadata:{freept_return:{...state,state:'delivered'}}});
            console.info('freept-account-return',{outcome:'delivered'});
          }
          return json(origin,{state:'login',email:login.email,token:login.token});
        }
        if(state.state==='denied')return json(origin,{state:'denied'});
        return json(origin,{state:'pending'});
      }
      // request
      if(typeof input.phone!=='string'||input.phone.length>32||
         (input.name!==undefined&&(typeof input.name!=='string'||input.name.length>80)))
        return json(origin,{error:'invalid_request'},400);
      if(state?.state==='pending')return json(origin,{state:'pending'});
      const candidates=phoneCandidates(input.phone);
      if(!candidates.length)return json(origin,{error:'invalid_phone'},400);
      const {data:rows}=await db.from('profiles').select('id,full_name,role,status')
        .in('phone',candidates).eq('role','user').limit(2);
      // Same answer whether or not a matching account exists.
      if(Array.isArray(rows)&&rows.length===1&&rows[0].status==='approved'){
        const open=(await pendingRequests(db)).filter(x=>x.r.target===rows[0].id);
        if(open.length<3){
          await db.auth.admin.updateUserById(me.id,{app_metadata:{freept_return:{
            state:'pending',target:rows[0].id,at:Date.now(),
            name:String(input.name||'').trim().slice(0,80)}}});
          console.info('freept-account-return',{outcome:'requested'});
        }
      }
      return json(origin,{state:'pending'});
    }

    if(!await isAdmin(db,me))return json(origin,{error:'not_found'},404);
    if(input.action==='list'){
      const pending=await pendingRequests(db);
      await cleanup(db);
      const ids=[...new Set(pending.map(x=>x.r.target))];
      const {data:profiles}=ids.length?await db.from('profiles').select('id,full_name,phone,status').in('id',ids):{data:[]};
      const byId=new Map((profiles||[]).map((p:any)=>[p.id,p]));
      return json(origin,{requests:pending.filter(x=>byId.has(x.r.target)).map(x=>{
        const p:any=byId.get(x.r.target);
        return {id:x.u.id,at:new Date(Number(x.r.at)).toISOString(),typedName:x.r.name||'',
          accountId:p.id,accountName:p.full_name,phone:maskPhone(p.phone)};
      }).sort((a,b)=>a.at<b.at?-1:1)});
    }
    if(!UUID.test(input.id))return json(origin,{error:'invalid_request'},400);
    const {data:found}=await db.auth.admin.getUserById(input.id);
    const requester=found?.user;
    const state=requester?.app_metadata?.freept_return;
    if(!requester||requester.is_anonymous!==true||state?.state!=='pending')
      return json(origin,{error:'not_found'},404);
    if(input.action==='deny'){
      await db.auth.admin.updateUserById(requester.id,{app_metadata:{freept_return:{...state,state:'denied',approvedAt:Date.now()}}});
      console.info('freept-account-return',{outcome:'denied'});
      return json(origin,{ok:true});
    }
    const {data:target}=await db.from('profiles').select('id,role,status').eq('id',state.target).maybeSingle();
    if(target?.role!=='user'||target?.status!=='approved')return json(origin,{error:'not_found'},404);
    const {data:account}=await db.auth.admin.getUserById(target.id);
    if(!account?.user)return json(origin,{error:'not_found'},404);
    const login=await loginFor(db,account.user);
    await db.auth.admin.updateUserById(requester.id,{app_metadata:{freept_return:{...state,state:'approved',login,approvedAt:Date.now()}}});
    console.info('freept-account-return',{outcome:'approved'});
    return json(origin,{ok:true});
  }catch(error){
    const category=error instanceof Error?error.message:'unknown';
    console.error('freept-account-return failed',{category:
      ['server_key_missing','link_failed','otp_failed','list_failed','account_has_email'].includes(category)?category:'unexpected'});
    return json(origin,{error:'unavailable'},503);
  }
});
