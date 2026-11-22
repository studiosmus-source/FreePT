// FreePT Bridge TEST: authenticated, authorization-fenced FCM wake.
// A wake contains no file name/path, credential or remote command; the TX must
// authenticate itself and claim pending jobs from the normal Bridge backend.
import {createClient} from 'npm:@supabase/supabase-js@2';
import {importPKCS8,SignJWT} from 'npm:jose@5';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT='aqjuixbuxftnjfzxmzuj';
const allowedOrigins=new Set(['https://localhost']);
const recent=new Map<string,number>();
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
    }catch{/* Legacy service_role fallback below */}
  }
  const old=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(old)return old;
  throw Error('server_key_missing');
}
async function googleToken(credentials:{client_email:string;private_key:string;project_id:string}){
  const key=await importPKCS8(credentials.private_key,'RS256');
  const now=Math.floor(Date.now()/1000);
  const signed=await new SignJWT({scope:'https://www.googleapis.com/auth/firebase.messaging'})
    .setProtectedHeader({alg:'RS256',typ:'JWT'})
    .setIssuer(credentials.client_email).setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now).setExpirationTime(now+3600).sign(key);
  const response=await fetch('https://oauth2.googleapis.com/token',{
    method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:jwt-bearer',assertion:signed})
  });
  if(!response.ok)throw Error('fcm_oauth_failed');
  const result=await response.json();
  if(typeof result?.access_token!=='string')throw Error('fcm_oauth_invalid');
  return result.access_token;
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
  let input:any;
  try{
    const body=await req.text();
    if(body.length>256)throw Error();
    input=JSON.parse(body);
    if(!input||typeof input!=='object'||Array.isArray(input)||
       Object.keys(input).length!==1||!UUID.test(input.jobId))throw Error();
  }catch{return json(origin,{error:'invalid_request'},400);}
  try{
    const url=Deno.env.get('SUPABASE_URL')||'';
    if(new URL(url).hostname!==PROJECT+'.supabase.co')throw Error('staging_only');
    const db=createClient(url,elevatedKey(),{
      auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
    });
    const {data:auth,error:authError}=await db.auth.getUser(authHeader.slice(7));
    if(authError||!auth.user?.id)return json(origin,{error:'authentication_required'},401);
    const adminId=auth.user.id;
    const {data:admin,error:adminError}=await db.from('profiles').select('role,status')
      .eq('id',adminId).maybeSingle();
    if(adminError||admin?.role!=='admin'||admin?.status!=='approved')
      return json(origin,{error:'not_found'},404);
    const {data:job,error:jobError}=await db.from('bridge_jobs')
      .select('id,device_id,receiver_id,state,created_at,expires_at')
      .eq('id',input.jobId).eq('receiver_id',adminId).maybeSingle();
    if(jobError||!job||job.state!=='queued'||
       Date.parse(job.expires_at)<=Date.now()||
       Date.now()-Date.parse(job.created_at)>120000)
      return json(origin,{error:'not_found'},404);
    const [{data:grant,error:grantError},{data:device,error:deviceError}]=await Promise.all([
      db.from('bridge_grants').select('device_id').eq('device_id',job.device_id)
        .eq('receiver_id',adminId).is('revoked_at',null).maybeSingle(),
      db.from('bridge_devices').select('owner_id,bridge_enabled')
        .eq('id',job.device_id).maybeSingle()
    ]);
    if(grantError||deviceError||!grant||!device?.bridge_enabled)
      return json(origin,{error:'not_found'},404);
    const {data:owner,error:ownerError}=await db.from('profiles').select('role,status')
      .eq('id',device.owner_id).maybeSingle();
    if(ownerError||owner?.role!=='user'||owner.status!=='approved')
      return json(origin,{error:'not_found'},404);
    // A valid five-minute TX session does NOT mean a bounded Android job
    // worker is still running. Never suppress a wake based on session expiry.
    const now=Date.now(),previous=recent.get(job.device_id)||0;
    // Jobs normally poll for several seconds; coalescing for only 2 seconds
    // prevents redundant push storms without delaying a later page/chunk.
    if(now-previous<2000)return json(origin,{queued:true,wake:'coalesced'});
    recent.set(job.device_id,now);
    if(recent.size>1000)for(const [key,at] of recent)
      if(now-at>120000)recent.delete(key);

    const {data:tokens,error:tokenError}=await db.from('push_devices')
      .select('token').eq('user_id',device.owner_id).limit(10);
    if(tokenError)throw Error('token_lookup_failed');
    if(!tokens?.length)return json(origin,{queued:true,wake:'no_token'});

    const credentials=JSON.parse(Deno.env.get('FCM_SERVICE_ACCOUNT_JSON')||'null');
    if(!credentials?.client_email||!credentials?.private_key||!credentials?.project_id)
      throw Error('fcm_credentials_missing');
    const access=await googleToken(credentials);
    const endpoint='https://fcm.googleapis.com/v1/projects/'+
      encodeURIComponent(credentials.project_id)+'/messages:send';
    let delivered=0;
    for(const entry of tokens){
      if(typeof entry.token!=='string')continue;
      const response=await fetch(endpoint,{
        method:'POST',
        headers:{authorization:'Bearer '+access,'content-type':'application/json'},
        body:JSON.stringify({message:{
          token:entry.token,
          data:{kind:'bridge_wake',version:'1'},
          android:{priority:'HIGH',ttl:'1800s',collapse_key:'freept_bridge_wake'}
        }})
      });
      if(response.ok)delivered++;
      else{
        const body=await response.text();
        if(/UNREGISTERED|registration-token-not-registered/i.test(body))
          await db.from('push_devices').delete().eq('token',entry.token)
            .eq('user_id',device.owner_id);
      }
    }
    return json(origin,{queued:true,wake:delivered?'sent':'undeliverable'});
  }catch(error){
    const category=error instanceof Error?error.message:'unknown';
    // Never log identifiers, tokens, paths, or private credential contents.
    console.error('freept-bridge-wake failed',{category:
      ['server_key_missing','staging_only','token_lookup_failed',
       'fcm_credentials_missing','fcm_oauth_failed','fcm_oauth_invalid'].includes(category)
        ?category:'unexpected'});
    return json(origin,{error:'wake_unavailable'},503);
  }
});
