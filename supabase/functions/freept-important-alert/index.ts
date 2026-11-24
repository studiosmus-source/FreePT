// FreePT important notices: approved admins only. No Android full-screen intent.
// This function is separate from chat pushes and never stores Firebase credentials in the APK.
import {createClient} from 'npm:@supabase/supabase-js@2';
import {importPKCS8,SignJWT} from 'npm:jose@5';
const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS'
};
const json=(payload:unknown,status=200)=>new Response(JSON.stringify(payload),{
  status,headers:{...cors,'Content-Type':'application/json'}
});
function elevatedKey():string{
  const raw=Deno.env.get('SUPABASE_SECRET_KEYS');
  if(raw){
    let keys:Record<string,unknown>;
    try{keys=JSON.parse(raw) as Record<string,unknown>}
    catch{throw Error('Invalid secret key configuration')}
    if(typeof keys.default==='string'&&keys.default.startsWith('sb_secret_'))return keys.default;
  }
  const old=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(old)return old;
  throw Error('Missing service role key');
}
async function googleAccessToken(creds:{client_email:string;private_key:string;project_id:string}){
  const key=await importPKCS8(creds.private_key,'RS256');
  const now=Math.floor(Date.now()/1000);
  const assertion=await new SignJWT({scope:'https://www.googleapis.com/auth/firebase.messaging'})
    .setProtectedHeader({alg:'RS256',typ:'JWT'})
    .setIssuer(creds.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now).setExpirationTime(now+3600).sign(key);
  const response=await fetch('https://oauth2.googleapis.com/token',{
    method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})
  });
  if(!response.ok)throw Error('Google OAuth error '+response.status);
  const value=await response.json();
  if(!value.access_token)throw Error('Google token missing');
  return String(value.access_token);
}
Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(req.method!=='POST')return json({error:'method_not_allowed'},405);
  let stage='authentication';
  try{
    const bearer=req.headers.get('authorization')||'';
    const token=/^Bearer (\S+)$/i.exec(bearer)?.[1];
    if(!token)return json({error:'unauthorized'},401);
    const db=createClient(Deno.env.get('SUPABASE_URL')!,elevatedKey(),{
      auth:{persistSession:false,autoRefreshToken:false}
    });
    const {data:auth,error:authError}=await db.auth.getUser(token);
    if(authError||!auth?.user?.id||auth.user.is_anonymous)return json({error:'unauthorized'},401);
    const actor=auth.user.id;
    stage='verify_admin';
    const {data:sender,error:senderError}=await db.from('profiles').select('id,role,status')
      .eq('id',actor).maybeSingle();
    if(senderError)throw senderError;
    if(sender?.role!=='admin'||sender.status!=='approved')
      return json({error:'forbidden'},403);
    let request:unknown;
    try{request=await req.json()}catch{return json({error:'invalid_json'},400)}
    if(!request||typeof request!=='object')return json({error:'invalid_request'},400);
    const input=request as Record<string,unknown>;
    const recipientId=input.recipientId;
    const title=input.title;
    const body=input.body;
    const apk=input.apk;
    let attachment:null|{url:string;sha256:string;versionName:string;versionCode:number}=null;
    if(apk!==undefined&&apk!==null){
      if(typeof apk!=='object'||Array.isArray(apk))return json({error:'invalid_apk'},400);
      const item=apk as Record<string,unknown>;
      const release=/^https:\/\/github\.com\/studiosmus-source\/FreePT\/releases\/download\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\.apk$/;
      if(Object.keys(item).sort().join(',')!=='sha256,url,versionCode,versionName'||
         typeof item.url!=='string'||!release.test(item.url)||
         typeof item.sha256!=='string'||!/^[a-f0-9]{64}$/i.test(item.sha256)||
         typeof item.versionName!=='string'||!/^\d+\.\d+\.\d+$/.test(item.versionName)||
         typeof item.versionCode!=='number'||!Number.isSafeInteger(item.versionCode)||
         item.versionCode<=0||item.versionCode>2147483647)
        return json({error:'invalid_apk'},400);
      attachment={url:item.url,sha256:item.sha256.toLowerCase(),
        versionName:item.versionName,versionCode:item.versionCode};
    }
    if(typeof recipientId!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(recipientId)
      ||typeof title!=='string'||typeof body!=='string')
      return json({error:'invalid_fields'},400);
    const cleanTitle=title.trim(),cleanBody=body.trim();
    if(cleanTitle.length>120||cleanBody.length<1||cleanBody.length>750)
      return json({error:'invalid_length'},400);
    stage='verify_recipient';
    const {data:recipient,error:recipientError}=await db.from('profiles').select('id,role,status')
      .eq('id',recipientId).maybeSingle();
    if(recipientError)throw recipientError;
    if(!recipient||recipient.role!=='user'||recipient.status!=='approved')
      return json({error:'recipient_not_approved'},400);
    stage='insert_alert';
    const {data:alert,error:insertError}=await db.from('important_alerts')
      .insert({sender_id:actor,recipient_id:recipientId,title:cleanTitle,body:cleanBody,apk_attachment:attachment})
      .select('id').single();
    if(insertError)throw insertError;
    stage='lookup_devices';
    const {data:devices,error:deviceError}=await db.from('push_devices').select('token')
      .eq('user_id',recipientId).limit(10);
    if(deviceError)throw deviceError;
    if(!devices?.length)return json({saved:true,accepted:0,rejected:0});
    stage='firebase';
    const credentials=JSON.parse(Deno.env.get('FCM_SERVICE_ACCOUNT_JSON')||'null');
    if(!credentials?.client_email||!credentials?.private_key||!credentials?.project_id)
      throw Error('Missing Firebase configuration');
    const access=await googleAccessToken(credentials);
    const endpoint='https://fcm.googleapis.com/v1/projects/'+encodeURIComponent(credentials.project_id)+'/messages:send';
    let accepted=0,rejected=0;
    for(const device of devices){
      const response=await fetch(endpoint,{
        method:'POST',
        headers:{Authorization:'Bearer '+access,'Content-Type':'application/json'},
        body:JSON.stringify({message:{
          token:device.token,
          notification:{title:cleanTitle||'FreePT',body:cleanBody},
          data:{kind:'freept_important_alert',alert_id:alert.id},
          android:{priority:'HIGH',notification:{channel_id:'freept-important'}}
        }})
      });
      if(response.ok){accepted++;continue}
      rejected++;
      const providerText=await response.text();
      if(/UNREGISTERED|registration-token-not-registered/i.test(providerText)){
        await db.from('push_devices').delete().eq('token',device.token).eq('user_id',recipientId);
      }
      console.error('freept-important-alert: fcm_rejected',{status:response.status});
    }
    console.info('freept-important-alert: delivery_summary',{accepted,rejected});
    return json({saved:true,accepted,rejected});
  }catch(error){
    console.error('freept-important-alert: failed',{stage,
      code:error&&typeof error==='object'&&'code' in error?String(error.code).slice(0,35):'unspecified'});
    // If the alert was saved, this failure must not be retried automatically.
    return json({error:'processing_failed',stage},500);
  }
});
