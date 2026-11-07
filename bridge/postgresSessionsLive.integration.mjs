import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createPostgresDeviceAuthenticator} from './postgresDeviceAuth.mjs';
import {BridgePostgresTxSessions} from './postgresTxSessions.mjs';
import {BridgePostgresJobsAdapter} from './postgresJobsAdapter.mjs';

// Test-only allowlisted SQL bridge, never used outside disposable CI.
const D='cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
const OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ADMIN='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const JOB='91919191-9191-4191-8191-919191919191';
const NEXT='92929292-9292-4292-8292-929292929292';
const SECRET='e'.repeat(64),SALT='b'.repeat(32);
const VERIFIER=createHash('sha256').update('freept-bridge-device-v1\0')
  .update(D).update('\0').update(SALT).update(SECRET).digest('hex');
const HEX=/^[0-9a-f]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const commands={
 bridge_server_open_tx_session:['p_device_id','p_token_hash_hex','p_verifier_hex'],
 bridge_server_assert_tx_session:['p_device_id','p_token_hash_hex'],
 bridge_server_close_tx_session:['p_device_id','p_token_hash_hex'],
 bridge_server_enqueue_list:['p_job_id','p_device_id','p_receiver_id'],
 bridge_server_claim_list:['p_device_id','p_session_binding_hex'],
 bridge_server_complete_list:['p_job_id','p_device_id','p_session_binding_hex']
};
function query(sql,vars={}) {
 return new Promise((resolve,reject)=>{
   if(process.env.PGDATABASE!=='bridge_test') return reject(Error('disposable_db_only'));
   const args=['-X','-A','-t','-v','ON_ERROR_STOP=1'];
   for(const [k,v] of Object.entries(vars)) {
     if(!/^p_(device_id|job_id|receiver_id|token_hash_hex|verifier_hex|session_binding_hex)$/.test(k) ||
       typeof v!=='string'||!(k==='p_device_id'||k==='p_job_id'||k==='p_receiver_id'?UUID:HEX).test(v))
       return reject(Error('invalid_ci_variable'));
     args.push('-v',k+'='+v);
   }
   args.push('-f','-');
   const ps=spawn('psql',args,{env:process.env,stdio:['pipe','pipe','pipe']});
   let output='',errors='';
   ps.stdout.on('data',x=>{output+=x;});
   ps.stderr.on('data',x=>{errors+=x;});
   ps.on('error',reject);
   ps.on('close',code=>code===0?resolve(output.trim()):reject(Error('ci_postgres_failed:'+errors.slice(0,160))));
   ps.stdin.end(sql+'\n');
 });
}
const rpcClient={async rpc(name,args){
 const expected=commands[name];
 if(!expected || !args || Object.keys(args).length!==expected.length ||
    !expected.every(k=>Object.hasOwn(args,k))) return {data:null,error:{code:'invalid_rpc'}};
 const list=expected.map(k=>k==='p_device_id'||k==='p_job_id'||k==='p_receiver_id'?
   ":'"+k+"'::uuid":":'"+k+"'");
 const sql="select coalesce(public."+name+"("+list.join(',')+")::text,'__EMPTY__');";
 try {
   const raw=await query(sql,args);
   if(raw==='__EMPTY__')return {data:null,error:null};
   const data=raw==='true'||raw==='t'?true:raw==='false'||raw==='f'?false:raw;
   return {data,error:null};
 } catch {return {data:null,error:{code:'db_rejected'}};}
}};
test('Node shared TX session and jobs adapter use same PostgreSQL authority',async ()=>{
 if(process.env.PGDATABASE!=='bridge_test')throw Error('disposable_db_only');
 await query(`insert into public.bridge_devices(id,owner_id,label) values
  ('${D}','${OWNER}','TX persistent CI');
  insert into public.bridge_device_verifiers(device_id,salt_hex,verifier_hex)
   values ('${D}','${SALT}','${VERIFIER}');
  select set_config('request.jwt.claim.sub','${OWNER}',false);
  select public.bridge_owner_grant('${D}','${ADMIN}');
  select public.bridge_owner_set_enabled('${D}',true);`);
 // This fixture reads the real persisted row, not a hardcoded auth result.
 const verifiersClient={from(table){
   if(table!=='bridge_device_verifiers')throw Error('unknown_table');
   return {select(columns){
     if(columns!=='device_id,salt_hex,verifier_hex')throw Error('unknown_columns');
     return {eq(key,id){
       if(key!=='device_id'||!UUID.test(id))throw Error('invalid_identity');
       return {async maybeSingle(){
         const result=await query(
           "select device_id::text||'|'||salt_hex||'|'||verifier_hex from public.bridge_device_verifiers where device_id='"+id+"';");
         if(!result)return {data:null,error:null};
         const [device_id,salt_hex,verifier_hex]=result.split('|');
         return {data:{device_id,salt_hex,verifier_hex},error:null};
       }};
     }};
   }};
 }};
 const authenticateDevice=createPostgresDeviceAuthenticator({verifiersClient});
 const sessions=new BridgePostgresTxSessions({rpcClient,authenticateDevice});
 const jobs=new BridgePostgresJobsAdapter({
   rpcClient,sessions,authenticateAdmin:async ctx=>ctx==='verified-admin'?
     {id:ADMIN,role:'admin',approved:true}:null
 });
 const a=await sessions.connect({deviceId:D,deviceSecret:SECRET});
 assert.equal(a.token.length,64);
 await jobs.requestList({authContext:'verified-admin',deviceId:D,jobId:JOB});
 assert.equal((await jobs.pollDevice({deviceId:D,sessionToken:a.token})).jobId,JOB);
 const b=await sessions.connect({deviceId:D,deviceSecret:SECRET});
 await assert.rejects(()=>jobs.completeDevice({
   deviceId:D,sessionToken:a.token,jobId:JOB
 }),/bridge_session_database_unavailable/);
 assert.equal(await query(`select state from public.bridge_jobs where id='${JOB}'`),'cancelled');
 await jobs.requestList({authContext:'verified-admin',deviceId:D,jobId:NEXT});
 assert.equal((await jobs.pollDevice({deviceId:D,sessionToken:b.token})).jobId,NEXT);
 assert.equal((await jobs.completeDevice({
   deviceId:D,sessionToken:b.token,jobId:NEXT
 })).state,'done');
 assert.equal(await sessions.close({deviceId:D,token:b.token}),true);
 await assert.rejects(()=>jobs.pollDevice({
   deviceId:D,sessionToken:b.token
 }),/bridge_session_database_unavailable/);
 await assert.rejects(()=>sessions.connect({deviceId:D,deviceSecret:'f'.repeat(64)}),
   /device_not_authenticated/);
 // Rotation uses the same canonical device KDF and a real committed database
 // update. It must invalidate both an active session and the previous secret.
 const active=await sessions.connect({deviceId:D,deviceSecret:SECRET});
 const rotatedSecret='f'.repeat(64), rotatedSalt='c'.repeat(32);
 const rotatedVerifier=createHash('sha256').update('freept-bridge-device-v1\0')
   .update(D).update('\0').update(rotatedSalt).update(rotatedSecret).digest('hex');
 await query(`update public.bridge_device_verifiers set
   salt_hex='${rotatedSalt}',verifier_hex='${rotatedVerifier}',
   rotated_at=clock_timestamp() where device_id='${D}';`);
 await assert.rejects(()=>sessions.getDispatchBinding({
   deviceId:D,token:active.token
 }),/bridge_session_database_unavailable/);
 await assert.rejects(()=>sessions.connect({deviceId:D,deviceSecret:SECRET}),
   /device_not_authenticated/);
 const rotated=await sessions.connect({deviceId:D,deviceSecret:rotatedSecret});
 assert.equal(rotated.token.length,64);
 assert.equal(await sessions.close({deviceId:D,token:rotated.token}),true);
});
