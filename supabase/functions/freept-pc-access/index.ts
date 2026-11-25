// FreePT TEST: one-time code that lets an approved user open the SAME FreePT
// account (same chat, profile and Bridge grants) on their Windows PC.
//
// Two entry points:
//  - {phone}: asked from the PC. If the number belongs to an approved user,
//    the code is posted INTO THAT USER'S CHAT (seen on their phone, with push).
//    The answer never reveals whether the number exists. Max 1 code / 2 min.
//  - {userId}: an approved administrator asks for the code (shown to them).
// Both attach a technical, non-routable email to the user's auth account (no
// email is ever sent; the profile is untouched) and ask Supabase Auth for a
// single-use email OTP.
// The PC signs in with verifyOtp(email,token). A new code replaces any unused
// earlier one (the technical email changes). No identifiers are logged.
import {createClient} from 'npm:@supabase/supabase-js@2';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT='aqjuixbuxftnjfzxmzuj';
const DOMAIN='freept-pc.invalid';
// No 0/o, 1/l/i: the code is read aloud or typed by hand.
const ALPHABET='abcdefghjkmnpqrstuvwxyz23456789';
const allowedOrigins=new Set(['https://localhost','https://app.freept.test']);
const REQUEST_GAP_MS=120000;
let windowStart=Date.now(),windowCount=0;
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
      if(typeof parsed?.default==='string'&&parsed.default.startsWith('sb_secret_'))
        return parsed.default;
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

/** Technical email + single-use OTP. null when the account has a real email. */
async function issueCode(db:any,user:any):Promise<string|null>{
  // Never replace a real (non-technical) email an account may already have.
  const current=user.email||'';
  if(current&&!current.endsWith('@'+DOMAIN))return null;
  const id=randomId(6);
  const email='pc-'+id+'@'+DOMAIN;
  const updated=await db.auth.admin.updateUserById(user.id,{email,email_confirm:true,
    app_metadata:{...(user.app_metadata||{}),pc_code_at:Date.now()}});
  if(updated.error)throw Error('link_failed');
  const link=await db.auth.admin.generateLink({type:'magiclink',email});
  const otp=link.data?.properties?.email_otp;
  if(link.error||typeof otp!=='string'||!/^[0-9]{6,10}$/.test(otp))throw Error('otp_failed');
  return id.toUpperCase()+'-'+otp;
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
/** PC asks; the code goes only into the matching user's own chat. */
async function requestFromPc(origin:string|null,db:any,phone:string){
  // Same answer whatever happens: never tells whether a number is registered.
  const generic=json(origin,{sent:true});
  const now=Date.now();
  if(now-windowStart>600000){windowStart=now;windowCount=0;}
  if(++windowCount>30)return generic;
  try{
    const candidates=phoneCandidates(phone);
    if(!candidates.length)return json(origin,{error:'invalid_phone'},400);
    const {data:rows}=await db.from('profiles').select('id,role,status')
      .in('phone',candidates).eq('role','user').eq('status','approved').limit(2);
    if(!Array.isArray(rows)||rows.length!==1)return generic;
    const userId=rows[0].id;
    const {data:existing}=await db.auth.admin.getUserById(userId);
    const user=existing?.user;
    if(!user)return generic;
    const last=Number(user.app_metadata?.pc_code_at||0);
    if(now-last<REQUEST_GAP_MS)return generic;
    // Sender: the administrator this person already shares with or chats with.
    let adminId:string|null=null;
    const {data:grants}=await db.from('bridge_grants')
      .select('receiver_id,bridge_devices!inner(owner_id)')
      .eq('bridge_devices.owner_id',userId).is('revoked_at',null).limit(1);
    if(Array.isArray(grants)&&grants[0]?.receiver_id)adminId=grants[0].receiver_id;
    if(!adminId){
      const {data:last}=await db.from('messages').select('sender_id')
        .eq('user_id',userId).neq('sender_id',userId)
        .order('created_at',{ascending:false}).limit(1);
      if(Array.isArray(last)&&last[0]?.sender_id)adminId=last[0].sender_id;
    }
    if(!adminId)return generic;
    const {data:admin}=await db.from('profiles').select('role,status').eq('id',adminId).maybeSingle();
    if(admin?.role!=='admin'||admin?.status!=='approved')return generic;
    const code=await issueCode(db,user);
    if(!code)return generic;
    const body='Codice per collegare il PC: '+code+'\n\n'+
      'Scrivilo nell’app FreePT sul computer. Vale una sola volta.\n'+
      'Se non hai chiesto tu di collegare un PC, ignora questo messaggio: senza il codice nessuno può entrare.';
    const {error}=await db.from('messages').insert({user_id:userId,sender_id:adminId,body});
    console.info('freept-pc-access',{outcome:error?'chat_failed':'issued_chat'});
  }catch(error){
    const category=error instanceof Error?error.message:'unknown';
    console.error('freept-pc-access request failed',{category:
      ['link_failed','otp_failed'].includes(category)?category:'unexpected'});
  }
  return generic;
}

Deno.serve(async(req:Request)=>{
  const origin=req.headers.get('origin');
  if(origin&&!allowedOrigins.has(origin))return json(null,{error:'origin_denied'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:{
    ...cors(origin),'access-control-allow-methods':'POST',
    'access-control-allow-headers':'authorization,apikey,content-type,x-client-info',
    'access-control-max-age':'300'
  }});
  if(req.method!=='POST')return json(origin,{error:'method_not_allowed'},405);
  let input:any;
  try{
    const body=await req.text();
    if(body.length>256)throw Error();
    input=JSON.parse(body);
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==1)throw Error();
    if(!(UUID.test(input.userId)||(typeof input.phone==='string'&&input.phone.length<=32)))throw Error();
  }catch{return json(origin,{error:'invalid_request'},400);}
  let db:any;
  try{
    const url=Deno.env.get('SUPABASE_URL')||'';
    if(new URL(url).hostname!==PROJECT+'.supabase.co')throw Error('staging_only');
    db=createClient(url,elevatedKey(),{
      auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
    });
  }catch{return json(origin,{error:'pc_access_unavailable'},503);}
  if(typeof input.phone==='string')return requestFromPc(origin,db,input.phone);
  const authHeader=req.headers.get('authorization')||'';
  if(!/^Bearer [^\s]{20,8192}$/.test(authHeader))
    return json(origin,{error:'authentication_required'},401);
  const userId:string=input.userId;
  try{
    const {data:auth,error:authError}=await db.auth.getUser(authHeader.slice(7));
    if(authError||!auth.user?.id||auth.user.is_anonymous===true)
      return json(origin,{error:'authentication_required'},401);
    const {data:admin,error:adminError}=await db.from('profiles').select('role,status')
      .eq('id',auth.user.id).maybeSingle();
    if(adminError||admin?.role!=='admin'||admin?.status!=='approved')
      return json(origin,{error:'not_found'},404);
    const {data:target,error:targetError}=await db.from('profiles').select('id,role,status')
      .eq('id',userId).maybeSingle();
    // Only approved ordinary users; never an administrator account.
    if(targetError||target?.id!==userId||target.role!=='user'||target.status!=='approved')
      return json(origin,{error:'not_found'},404);
    const {data:existing,error:existingError}=await db.auth.admin.getUserById(userId);
    if(existingError||!existing?.user)return json(origin,{error:'not_found'},404);
    const issued=await issueCode(db,existing.user);
    if(!issued)return json(origin,{error:'account_has_email'},409);
    console.info('freept-pc-access',{outcome:'issued_admin'});
    return json(origin,{code:issued});
  }catch(error){
    const category=error instanceof Error?error.message:'unknown';
    console.error('freept-pc-access failed',{category:
      ['server_key_missing','staging_only','link_failed','otp_failed'].includes(category)
        ?category:'unexpected'});
    return json(origin,{error:'pc_access_unavailable'},503);
  }
});
