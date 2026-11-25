// FreePT TEST: one-time code that lets an approved user open the SAME FreePT
// account (same chat, profile and Bridge grants) on their Windows PC.
//
// Called only by an approved administrator. It attaches a technical,
// non-routable email to the user's auth account (no message is ever sent, the
// profile/chat are untouched) and asks Supabase Auth for a single-use email OTP.
// The PC signs in with verifyOtp(email,token). A new code replaces any unused
// earlier one (the technical email changes). No identifiers are logged.
import {createClient} from 'npm:@supabase/supabase-js@2';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT='aqjuixbuxftnjfzxmzuj';
const DOMAIN='freept-pc.invalid';
// No 0/o, 1/l/i: the code is read aloud or typed by hand.
const ALPHABET='abcdefghjkmnpqrstuvwxyz23456789';
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

Deno.serve(async(req:Request)=>{
  const origin=req.headers.get('origin');
  if(origin&&!allowedOrigins.has(origin))return json(null,{error:'origin_denied'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:{
    ...cors(origin),'access-control-allow-methods':'POST',
    'access-control-allow-headers':'authorization,apikey,content-type,x-client-info',
    'access-control-max-age':'300'
  }});
  if(req.method!=='POST')return json(origin,{error:'method_not_allowed'},405);
  const authHeader=req.headers.get('authorization')||'';
  if(!/^Bearer [^\s]{20,8192}$/.test(authHeader))
    return json(origin,{error:'authentication_required'},401);
  let userId:string;
  try{
    const body=await req.text();
    if(body.length>256)throw Error();
    const input=JSON.parse(body);
    if(!input||typeof input!=='object'||Array.isArray(input)||
       Object.keys(input).length!==1||!UUID.test(input.userId))throw Error();
    userId=input.userId;
  }catch{return json(origin,{error:'invalid_request'},400);}
  try{
    const url=Deno.env.get('SUPABASE_URL')||'';
    if(new URL(url).hostname!==PROJECT+'.supabase.co')throw Error('staging_only');
    const db=createClient(url,elevatedKey(),{
      auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
    });
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
    // Never replace a real (non-technical) email an account may already have.
    const current=existing.user.email||'';
    if(current&&!current.endsWith('@'+DOMAIN))return json(origin,{error:'account_has_email'},409);

    const id=randomId(6);
    const email='pc-'+id+'@'+DOMAIN;
    const updated=await db.auth.admin.updateUserById(userId,{email,email_confirm:true});
    if(updated.error)throw Error('link_failed');
    const link=await db.auth.admin.generateLink({type:'magiclink',email});
    const otp=link.data?.properties?.email_otp;
    if(link.error||typeof otp!=='string'||!/^[0-9]{6,10}$/.test(otp))throw Error('otp_failed');
    console.info('freept-pc-access',{outcome:'issued'});
    return json(origin,{code:id.toUpperCase()+'-'+otp});
  }catch(error){
    const category=error instanceof Error?error.message:'unknown';
    console.error('freept-pc-access failed',{category:
      ['server_key_missing','staging_only','link_failed','otp_failed'].includes(category)
        ?category:'unexpected'});
    return json(origin,{error:'pc_access_unavailable'},503);
  }
});
