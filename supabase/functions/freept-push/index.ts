// Supabase Edge Function: sends generic (no message text) Android pushes.
// Configure Database Webhook on public.messages INSERT with header
// "x-freept-webhook-key": <the private FREEPT_WEBHOOK_KEY>.
// Deploy with JWT verification disabled, but ALWAYS validate this header.
// Required Supabase secrets: FREEPT_WEBHOOK_KEY, FCM_SERVICE_ACCOUNT_JSON,
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Never put credentials in the APK.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { importPKCS8, SignJWT } from 'npm:jose@5';

type Hook = {
  type?: string;
  table?: string;
  schema?: string;
  record?: { id?: string; user_id?: string; sender_id?: string };
};

const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{
  auth:{persistSession:false,autoRefreshToken:false}
});
const json=(body:unknown,code=200)=>new Response(JSON.stringify(body),{
  status:code,headers:{'Content-Type':'application/json'}
});

function equalSecret(a:string,b:string){
  if(!a||!b)return false;
  const encoder=new TextEncoder();
  const x=encoder.encode(a),y=encoder.encode(b);
  let diff=x.length^y.length;
  for(let i=0;i<Math.max(x.length,y.length);i++)diff|=(x[i]||0)^(y[i]||0);
  return diff===0;
}
async function googleAccessToken(credentials:{
  client_email:string;private_key:string;token_uri?:string;project_id:string
}){
  const key=await importPKCS8(credentials.private_key,'RS256');
  const now=Math.floor(Date.now()/1000);
  const assertion=await new SignJWT({
    scope:'https://www.googleapis.com/auth/firebase.messaging'
  }).setProtectedHeader({alg:'RS256',typ:'JWT'})
    .setIssuer(credentials.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now).setExpirationTime(now+3600).sign(key);
  const response=await fetch('https://oauth2.googleapis.com/token',{
    method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({
      grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });
  if(!response.ok)throw Error('Could not obtain Google OAuth access token: '+response.status);
  const data=await response.json();
  return String(data.access_token||'');
}
Deno.serve(async req=>{
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  const expected=Deno.env.get('FREEPT_WEBHOOK_KEY')||'';
  if(!equalSecret(req.headers.get('x-freept-webhook-key')||'',expected))
    return json({error:'Unauthorized'},401);
  try{
    const event=await req.json() as Hook;
    if(event.type!=='INSERT'||event.schema!=='public'||event.table!=='messages'||!event.record?.id)
      return json({ignored:true});
    const {data:msg,error:msgError}=await db.from('messages')
      .select('id,user_id,sender_id').eq('id',event.record.id).maybeSingle();
    if(msgError)throw msgError;
    if(!msg||msg.user_id!==event.record.user_id||msg.sender_id!==event.record.sender_id)
      return json({ignored:true});
    const {data:sender,error:senderError}=await db.from('profiles')
      .select('id,role,status').eq('id',msg.sender_id).maybeSingle();
    if(senderError)throw senderError;
    if(sender?.status!=='approved')return json({ignored:true});
    let recipients:string[]=[];
    if(sender.role==='admin'){
      const {data:user,error}=await db.from('profiles').select('id,status,role')
        .eq('id',msg.user_id).maybeSingle();
      if(error)throw error;
      if(user?.role==='user'&&user.status==='approved')recipients=[user.id];
    }else{
      if(msg.user_id!==msg.sender_id)return json({ignored:true});
      const {data:admins,error}=await db.from('profiles')
        .select('id').eq('role','admin').eq('status','approved');
      if(error)throw error;
      recipients=(admins||[]).map(a=>a.id);
    }
    recipients=recipients.filter(id=>id!==msg.sender_id);
    if(recipients.length===0)return json({delivered:0});
    const {data:devices,error:devicesError}=await db.from('push_devices')
      .select('token,user_id').in('user_id',recipients).limit(500);
    if(devicesError)throw devicesError;
    if(!devices?.length)return json({delivered:0});
    const credentials=JSON.parse(Deno.env.get('FCM_SERVICE_ACCOUNT_JSON')||'null');
    if(!credentials?.client_email||!credentials?.private_key||!credentials?.project_id)
      throw Error('Missing FCM service account secret');
    const oauthToken=await googleAccessToken(credentials);
    const endpoint='https://fcm.googleapis.com/v1/projects/'+encodeURIComponent(credentials.project_id)+'/messages:send';
    let sent=0,failed=0;
    for(const device of devices){
      const response=await fetch(endpoint,{
        method:'POST',headers:{
          'Authorization':'Bearer '+oauthToken,'Content-Type':'application/json'
        },
        body:JSON.stringify({message:{
          token:device.token,
          notification:{title:'FreePT',body:'Hai un nuovo messaggio'},
          data:{kind:'freept_message'},
          android:{priority:'HIGH',notification:{channel_id:'default'}}
        }})
      });
      if(response.ok){sent++;continue}
      failed++;
      const errorText=await response.text();
      // Only remove definitively expired device registrations, never user profiles.
      if(/UNREGISTERED|registration-token-not-registered/i.test(errorText)){
        await db.from('push_devices').delete().eq('token',device.token).eq('user_id',device.user_id);
      }
      console.error('FCM send failed:',response.status,errorText.slice(0,300));
    }
    return json({delivered:sent,failed});
  }catch(e){
    console.error('FreePT push delivery error:',String(e));
    return json({error:'Delivery failed'},500);
  }
});
