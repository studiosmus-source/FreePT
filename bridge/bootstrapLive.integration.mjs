/** Disposable PostgreSQL + real HTTP gateway + real ECDSA/chunk integrity. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {generateKeyPairSync,sign,randomBytes,randomUUID} from 'node:crypto';
import {createBootstrapHandler} from './bootstrapHandler.mjs';
import {createBridgeHttpsGateway} from './httpsGateway.mjs';
import {bootstrapBytes,bootstrapMessage,bootstrapHash} from './bootstrapProtocol.mjs';
if(process.env.PGDATABASE!=='bridge_test')throw Error('disposable_database_required');
const ADMIN='abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',OWNER='accccccc-cccc-4ccc-8ccc-cccccccccccc';
const TOKEN='ci_admin_authenticated_token_only',USER='ci_personal_authenticated_token_only';
function sql(statement){
 const r=spawnSync('psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-f','-'],{input:statement,encoding:'utf8'});
 if(r.status!==0)throw Error('ci_db_failed:'+r.stderr.slice(0,500));return r.stdout.trim();
}
const q=value=>value===null?'null':`convert_from(decode('${Buffer.from(String(value)).toString('hex')}','hex'),'UTF8')`;
const db={
 async rpc(name,a){
  if(name!=='bridge_bootstrap_step')throw Error('unexpected_rpc');
  try{
   const s=`select public.bridge_bootstrap_step(${q(a.p_action)},${q(a.p_id)}::uuid,${q(a.p_key)},${q(a.p_nonce)},${q(JSON.stringify(a.p_data))}::jsonb,${q(a.p_actor)}::uuid);`;
   return {data:JSON.parse(sql(s)),error:null};
  }catch{return {data:null,error:{code:'denied'}};}
 },
 from(table){return {select(columns){return {eq(field,id){return {async maybeSingle(){
  if(!['bridge_bootstrap_devices','profiles'].includes(table)||field!=='id'||!/^[0-9a-f-]{36}$/.test(id))throw Error('invalid_ci_query');
  if(!['public_key','challenge','id,role,status'].includes(columns))throw Error('invalid_columns');
  const raw=sql(`select row_to_json(t) from (select ${columns} from public.${table} where id=${q(id)}::uuid) t;`);
  return {data:raw?JSON.parse(raw):null,error:null};
 }}}}}};}
};
const authClient={auth:{getUser:async token=>({data:{user:token===TOKEN?{id:ADMIN,is_anonymous:false}:token===USER?{id:OWNER,is_anonymous:true}:null}})}};
function device(){
 const k=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),id=randomUUID();
 const publicKey=k.publicKey.export({type:'spki',format:'der'}).toString('base64'),pairCode=randomBytes(6).toString('hex');
 const envelope=(action,data={})=>{
  const e={deviceId:id,timestamp:Date.now(),nonce:randomBytes(16).toString('hex'),payload:JSON.stringify(data)};
  e.signature=sign('sha256',Buffer.from(bootstrapMessage(action,e)),k.privateKey).toString('base64');return e;
 };
 return {id,publicKey,pairCode,envelope};
}
test('pre-profile signed TX transfers 300000 synthetic bytes only after admin approval; promotion and revocation are fenced',async()=>{
 sql(`insert into public.profiles(id,role,status) values('${ADMIN}','admin','approved') on conflict(id) do update set status='approved';`);
 const handler=createBootstrapHandler({authClient,db,enabled:true});
 const denied=async()=>({status:403,body:{error:'denied'}});
 const gateway=createBridgeHttpsGateway({admin:denied,owner:denied,tx:denied,bootstrap:handler,config:{origins:['https://localhost']},allowHttpInUnitTests:true});
 const address=await gateway.start();
 async function post(action,body,token){
  const r=await fetch(`http://127.0.0.1:${address.port}/bridge/bootstrap/${action}`,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
  return {status:r.status,body:await r.json()};
 }
 try{
  const d=device();
  const start=d.envelope('start',{publicKey:d.publicKey,pairCode:d.pairCode,consent:true});
  assert.equal((await post('start',start)).body.state,'pending');
  assert.equal((await post('start',start)).status,403,'replay must fail');
  assert.equal((await post('poll',d.envelope('poll'))).body.state,'pending');
  assert.equal(sql(`select count(*) from public.profiles where id='${d.id}'`),'0','technical identity must not create a personal profile');
  assert.equal((await post('approve',{pairCode:d.pairCode})).status,403);
  assert.equal((await post('approve',{pairCode:d.pairCode},USER)).status,403);
  assert.equal((await post('approve',{pairCode:d.pairCode},TOKEN)).body.approved,true);
  assert.equal((await post('approve',{pairCode:d.pairCode},TOKEN)).status,403,'one-time pairing');
  let job=(await post('poll',d.envelope('poll'))).body.job;
  assert.equal(job.operation,'diagnostic');assert.equal(job.size,300000);
  const forged=d.envelope('chunk',{offset:job.offset,base64:Buffer.alloc(job.length).toString('base64')});
  assert.equal((await post('chunk',forged)).status,400,'corruption rejected');
  for(let i=0;i<2;i++){
   job=(await post('poll',d.envelope('poll'))).body.job;
   const chunk=d.envelope('chunk',{offset:job.offset,base64:bootstrapBytes(job.challenge,job.offset,job.length).toString('base64')});
   const answer=await post('chunk',chunk);assert.equal(answer.status,200);assert.equal(answer.body.received,job.offset+job.length);
   assert.equal((await post('chunk',chunk)).status,403,'chunk replay rejected');
  }
  assert.equal((await post('status',d.envelope('status'))).body.state,'verified');
  const secret=randomBytes(32).toString('hex');
  assert.equal((await post('claim',d.envelope('claim',{deviceSecret:secret,accountProof:bootstrapHash(USER)}),USER)).status,403,'no personal profile yet');
  sql(`insert into public.profiles(id,role,status) values('${OWNER}','user','pending') on conflict(id) do update set status='pending';`);
  assert.equal((await post('claim',d.envelope('claim',{deviceSecret:secret,accountProof:bootstrapHash(USER)}),USER)).status,403,'pending profile cannot receive private-file grant');
  sql(`update public.profiles set status='approved' where id='${OWNER}'`);
  assert.equal((await post('claim',d.envelope('claim',{deviceSecret:secret,accountProof:bootstrapHash('other-account')}),USER)).status,403,'signed proof cannot swap personal login tokens');
  assert.equal((await post('claim',d.envelope('claim',{deviceSecret:secret,accountProof:bootstrapHash(USER)}),USER)).body.bound,true);
  assert.equal((await post('claim',d.envelope('claim',{deviceSecret:secret,accountProof:bootstrapHash(USER)}),USER)).body.bound,true,'lost response can safely retry');
  assert.equal(sql(`select receiver_id from public.bridge_grants where device_id='${d.id}'`),ADMIN);
  assert.equal((await post('revoke',{deviceId:d.id},TOKEN)).body.revoked,true);
  assert.equal((await post('status',d.envelope('status'))).status,403);
  assert.equal(sql(`select bridge_enabled from public.bridge_devices where id='${d.id}'`),'f');
  const other=device();
  await post('start',other.envelope('start',{publicKey:other.publicKey,pairCode:other.pairCode,consent:true}));
  const alien=other.envelope('poll');alien.deviceId=d.id;
  assert.equal((await post('poll',alien)).status,403,'proof cannot move to another device');
  await post('approve',{pairCode:other.pairCode},TOKEN);
  sql(`update public.profiles set status='blocked' where id='${ADMIN}'`);
  assert.equal((await post('poll',other.envelope('poll'))).status,403,'revoked admin immediately fences its grant');
  sql(`update public.profiles set status='approved' where id='${ADMIN}'`);
  sql(`update public.bridge_bootstrap_devices set expires_at=now()-interval '1 second' where id='${other.id}'`);
  assert.equal((await post('status',other.envelope('status'))).status,403,'expired approval cannot open registration');

 }finally{await gateway.stop();}
});
test('bootstrap schema denies anon/authenticated execution and raw table access',()=>{
 assert.equal(sql("select has_function_privilege('anon','public.bridge_bootstrap_step(text,uuid,text,text,jsonb,uuid)','execute')"),'f');
 assert.equal(sql("select has_function_privilege('authenticated','public.bridge_bootstrap_step(text,uuid,text,text,jsonb,uuid)','execute')"),'f');
 assert.equal(sql("select has_table_privilege('anon','public.bridge_bootstrap_devices','select')"),'f');
 assert.equal(sql("select relrowsecurity from pg_class where oid='public.bridge_bootstrap_devices'::regclass"),'t');
});
