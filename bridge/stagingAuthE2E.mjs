/** Explicit one-off provisioning of NEW disposable test identities; never a public API.
 * Passwords/service credentials/access tokens remain in this process only.
 */
import {randomBytes,randomUUID,generateKeyPairSync,sign} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {bootstrapMessage,bootstrapHash,bootstrapBytes} from './bootstrapProtocol.mjs';
export const AUTH_E2E_RUN='AUTH_E2E_NEW_FIXTURES_20261119_01';
const TARGET='https://freept-bridge-staging.onrender.com';
export function authE2EEnabled(env,config){
 if(env?.FREEPT_BRIDGE_AUTH_E2E!==AUTH_E2E_RUN)return false;
 if(config.url!=='https://aqjuixbuxftnjfzxmzuj.supabase.co'||env.FREEPT_BRIDGE_BOOTSTRAP!=='STAGING_DEVICE_KEY_V1'||env.FREEPT_BRIDGE_TEST_CONSOLE!=='AUTH_E2E_ONLY')throw Error('auth_e2e_isolation_required');
 return true;
}
export async function runStagingAuthE2E({config,publish,clientFactory=createClient,fetchFn=fetch,wait=ms=>new Promise(r=>setTimeout(r,ms))}){
 if(config.url!=='https://aqjuixbuxftnjfzxmzuj.supabase.co')throw Error('auth_e2e_test_project_required');
 const report={run:AUTH_E2E_RUN,startedAt:new Date().toISOString(),level:'Node P256 -> real staging HTTPS -> real Supabase Auth and database; not Android',phase:'waiting_for_gateway',checks:[],completeEndToEnd:false,fixtures:{}};
 const update=()=>publish(JSON.parse(JSON.stringify(report)));
 const check=(name,ok)=>{if(!ok){report.failedCheck=name;throw Error('check_failed');}report.checks.push({name,result:'PASS'});update();};
 const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
 const db=clientFactory(config.url,config.serviceKey,options),admin=clientFactory(config.url,config.publishable,options),user=clientFactory(config.url,config.publishable,options);
 let adminId,userId,adminToken,userToken,device,envelope,started=false,bound=false,revoked=false;
 const post=async(action,body,token)=>{
  const r=await fetchFn(TARGET+'/bridge/bootstrap/'+action,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(55000)});
  return {status:r.status,body:await r.json()};
 };
 update();
 try{
  let ready=false;
  for(let i=0;i<45;i++){
   try{const r=await fetchFn(TARGET+'/test/server-e2e.json',{signal:AbortSignal.timeout(5000)});ready=r.ok&&(await r.json()).run===AUTH_E2E_RUN;}catch{}
   if(ready)break;await wait(2000);
  }
  check('Dedicated HTTPS gateway serves exact one-off run',ready);
  report.phase='provisioning_new_test_accounts';update();
  // Roll back only the exact unconfigured Auth identity created by failed attempt 01.
  // Never reset a password or select/delete an unrelated or configured account.
  const failedId='c1a3e09a-0289-4559-9a08-827839e53dd7';
  const failed=await db.auth.admin.getUserById(failedId);
  if(failed.data?.user){
   const u=failed.data.user;
   const profile=await db.from('profiles').select('id').eq('id',failedId).maybeSingle();
   check('Failed fixture rollback identity and no profile verified',u.id===failedId&&u.email==='freept-auth-e2e-admin-20261119-01@tests.freept.invalid'&&u.app_metadata?.freept_test_fixture===AUTH_E2E_RUN&&!profile.error&&profile.data===null);
   const removal=await db.auth.admin.deleteUser(failedId);
   check('Only failed new unconfigured Auth fixture rolled back',!removal.error);
   report.failedProvisioningRolledBack=true;
  }else if(failed.error&&failed.error.status!==404)throw Error('fixture_cleanup_lookup_failed');
  // Fixed names make restart fail closed on duplicate, without resetting an account.
  for(const [kind,client] of [['admin',admin],['user',user]]){
   const email='freept-auth-e2e-'+kind+'-20261119-01@tests.freept.invalid';
   let password=randomBytes(36).toString('base64url')+'!aA7';
   const created=await db.auth.admin.createUser({email,password,email_confirm:true,app_metadata:{freept_test_fixture:AUTH_E2E_RUN}});
   check('Official Auth Admin API creates NEW '+kind, !created.error&&!!created.data?.user?.id);
   const id=created.data.user.id;report.fixtures[kind+'Id']=id;
   if(kind==='admin')adminId=id;else userId=id;
   // Provision only the newly returned admin id, never upsert or modify an existing id.
   if(kind==='admin'){
    const p=await db.from('profiles').insert({id,full_name:'FreePT TEST E2E admin 20261119-01',phone:'+999202611190011',role:'admin',status:'approved'});
    check('Provision only new authorized TEST admin profile',!p.error);
   }
   const login=await client.auth.signInWithPassword({email,password});password=undefined;
   check('Real Supabase password login '+kind,!login.error&&!!login.data?.session?.access_token);
   const token=login.data.session.access_token;
   const actual=await client.auth.getUser(token);
   check('Supabase Auth getUser verifies '+kind,!actual.error&&actual.data?.user?.id===id&&actual.data.user.is_anonymous!==true);
   if(kind==='admin')adminToken=token;else userToken=token;
  }
  const personal=await db.from('profiles').select('id').eq('id',userId).maybeSingle();
  check('No personal profile before pre-account diagnostic',!personal.error&&personal.data===null);
  device=randomUUID();report.fixtures.deviceId=device;
  const keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),publicKey=keys.publicKey.export({type:'spki',format:'der'}).toString('base64'),pairCode=randomBytes(6).toString('hex');
  envelope=(action,data={})=>{const e={deviceId:device,timestamp:Date.now(),nonce:randomBytes(16).toString('hex'),payload:JSON.stringify(data)};e.signature=sign('sha256',Buffer.from(bootstrapMessage(action,e)),keys.privateKey).toString('base64');return e;};
  report.phase='authenticated_https_protocol';update();
  const initial=envelope('start',{publicKey,pairCode,consent:true});let r=await post('start',initial);
  check('Signed pre-account start pending',r.status===200&&r.body.state==='pending');started=true;
  r=await post('start',initial);check('Start replay denied by persistent nonce',r.status===403);
  r=await post('poll',envelope('poll'));check('No diagnostic before admin consent',r.status===200&&r.body.state==='pending'&&!r.body.job);
  r=await post('approve',{pairCode},userToken);check('Personal token cannot approve',r.status===403);
  const wrong=(pairCode[0]==='0'?'1':'0')+pairCode.slice(1);
  r=await post('approve',{pairCode:wrong},adminToken);check('Wrong code denied to actual authenticated admin',r.status===403);
  r=await post('approve',{pairCode},adminToken);check('Admin approves via authenticated HTTPS route',r.status===200&&r.body.approved===true&&r.body.deviceId===device);
  r=await post('approve',{pairCode},adminToken);check('Approval code single use',r.status===403);
  const parts=[];
  for(let i=0;i<2;i++){
   r=await post('poll',envelope('poll'));const job=r.body.job;
   check('Synthetic diagnostic chunk job '+i,r.status===200&&job?.operation==='diagnostic'&&job.size===300000&&job.offset===(i?262144:0)&&job.length===(i?37856:262144));
   const bytes=bootstrapBytes(job.challenge,job.offset,job.length);parts.push(bytes);
   if(!i){const bad=Buffer.from(bytes);bad[0]^=1;r=await post('chunk',envelope('chunk',{offset:0,base64:bad.toString('base64')}));check('Corrupted synthetic chunk denied',r.status===400);}
   const chunk=envelope('chunk',{offset:job.offset,base64:bytes.toString('base64')});r=await post('chunk',chunk);
   check('Actual HTTPS receipt chunk '+i,r.status===200&&r.body.received===job.offset+job.length);
   r=await post('chunk',chunk);check('Chunk replay denied '+i,r.status===403);
  }
  report.bytes=Buffer.concat(parts).length;report.sha256=bootstrapHash(Buffer.concat(parts));
  r=await post('status',envelope('status'));check('Server verified 300000 bytes and exact SHA256',report.bytes===300000&&r.status===200&&r.body.state==='verified'&&r.body.sha256===report.sha256);
  const deviceSecret=randomBytes(32).toString('hex'),claim=()=>envelope('claim',{deviceSecret,accountProof:bootstrapHash(userToken)});
  r=await post('claim',claim(),userToken);check('Claim denied before personal registration',r.status===403);
  // Fixture provisioning creates pending registration. Actual approval below uses admin's RLS-bound session.
  const registration=await db.from('profiles').insert({id:userId,full_name:'FreePT TEST E2E user 20261119-01',phone:'+999202611190012',role:'user',status:'pending'});
  check('Only new TEST personal profile provisioned pending',!registration.error);
  r=await post('claim',claim(),userToken);check('Pending personal profile cannot claim',r.status===403);
  const approval=await admin.from('profiles').update({status:'approved'}).eq('id',userId).select('id,status');
  check('Actual authenticated admin approves personal profile under RLS',!approval.error&&approval.data?.length===1&&approval.data[0].id===userId&&approval.data[0].status==='approved');
  r=await post('claim',envelope('claim',{deviceSecret,accountProof:bootstrapHash('substituted-session')}),userToken);check('Account proof rejects token substitution',r.status===403);
  r=await post('claim',claim(),userToken);check('Actual personal Auth session claims diagnostic device',r.status===200&&r.body.bound===true&&r.body.deviceId===device);bound=true;
  r=await post('claim',claim(),userToken);check('Claim response-loss retry idempotent',r.status===200&&r.body.bound===true);
  const d=await db.from('bridge_devices').select('owner_id,bridge_enabled').eq('id',device).single(),g=await db.from('bridge_grants').select('receiver_id,revoked_at').eq('device_id',device).single();
  check('Database confirms exact owner and approving admin grant',!d.error&&!g.error&&d.data.owner_id===userId&&d.data.bridge_enabled===true&&g.data.receiver_id===adminId&&g.data.revoked_at===null);
  r=await post('revoke',{deviceId:device},adminToken);check('Actual admin revokes test device',r.status===200&&r.body.revoked===true);revoked=true;
  r=await post('status',envelope('status'));check('Revocation fences device immediately',r.status===403);
  const stopped=await db.from('bridge_devices').select('bridge_enabled').eq('id',device).single(),grant=await db.from('bridge_grants').select('revoked_at').eq('device_id',device).single();
  check('Revoked grant and disabled device persisted',!stopped.error&&!grant.error&&stopped.data.bridge_enabled===false&&!!grant.data.revoked_at);
  report.completeEndToEnd=true;report.phase='passed';
 }catch(e){report.phase='failed';report.failure=report.failedCheck||'unexpected_runtime_error';}
 finally{
  if(started&&!revoked){try{const r=bound?await post('revoke',{deviceId:device},adminToken):await post('cancel',envelope('cancel'));report.cleanup=r.status===200?'revoked_or_cancelled':'FAILED';}catch{report.cleanup='FAILED';}}
  // Invalidate only the sessions newly created here, not sessions of preexisting users.
  for(const [kind,client] of [['admin',admin],['user',user]]){try{const r=await client.auth.signOut({scope:'local'});report[kind+'TestSessionSignedOut']=!r.error;}catch{report[kind+'TestSessionSignedOut']=false;}}
  report.finishedAt=new Date().toISOString();report.notExecuted=['Android hardware Keystore','Oppo physical SAF and background','Actual elapsed approval expiry'];update();
 }
 return report;
}
