import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {BridgePostgresJobsAdapter} from './postgresJobsAdapter.mjs';
import {BridgeRegistry} from './deviceRouting.mjs';
import {BridgeDeviceCredentials} from './deviceCredentials.mjs';
import {BridgeDeviceSessionGate} from './deviceSessions.mjs';

// Test-only Postgres adapter: executes a fixed, allowlisted SQL statement in
// the ephemeral GitHub Actions database. Not a production RPC client.
const DEVICE='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ADMIN='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const JOB='55555555-5555-4555-8555-555555555555';
const DENIED='66666666-6666-4666-8666-666666666666';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEX=/^[0-9a-f]{64}$/;
const commands={
  bridge_server_enqueue_list:{
    keys:['p_job_id','p_device_id','p_receiver_id'],
    sql:"select public.bridge_server_enqueue_list(:'p_job_id'::uuid,:'p_device_id'::uuid,:'p_receiver_id'::uuid)::text;"
  },
  bridge_server_claim_list:{
    keys:['p_device_id','p_session_binding_hex'],
    sql:"select coalesce(public.bridge_server_claim_list(:'p_device_id'::uuid,:'p_session_binding_hex')::text,'__EMPTY__');"
  },
  bridge_server_complete_list:{
    keys:['p_job_id','p_device_id','p_session_binding_hex'],
    sql:"select public.bridge_server_complete_list(:'p_job_id'::uuid,:'p_device_id'::uuid,:'p_session_binding_hex')::text;"
  }
};
function query(sql,vars={}) {
  return new Promise((resolve,reject)=>{
    const args=['-X','-A','-t','-v','ON_ERROR_STOP=1'];
    for(const [key,value] of Object.entries(vars)) {
      if(!/^p_(job_id|device_id|receiver_id|session_binding_hex)$/.test(key) ||
          typeof value!=='string' ||
          !(key==='p_session_binding_hex'?HEX:UUID).test(value))
        return reject(new Error('invalid_ci_sql_variable'));
      args.push('-v',key+'='+value);
    }
    args.push('-f','-');
    const p=spawn('psql',args,{env:process.env,stdio:['pipe','pipe','pipe']});
    let out='',err='';
    p.stdout.setEncoding('utf8');p.stderr.setEncoding('utf8');
    p.stdout.on('data',chunk=>{out+=chunk;});
    p.stderr.on('data',chunk=>{err+=chunk;});
    p.on('error',reject);
    p.on('close',code=>code===0?resolve(out.trim()):reject(new Error('psql_failed:'+err.slice(0,500))));
    p.stdin.end(sql+'\n');
  });
}
function rpcClient() {
  return {async rpc(name,args){
    const command=commands[name];
    if(!command || !args || Object.keys(args).length!==command.keys.length ||
        !command.keys.every(key=>Object.hasOwn(args,key)))
      return {data:null,error:{code:'invalid_rpc'}};
    try {
      const raw=await query(command.sql,args);
      if(raw==='__EMPTY__')return {data:null,error:null};
      return {data:(raw==='t'||raw==='true')?true:(raw==='f'||raw==='false')?false:raw,error:null};
    } catch {
      return {data:null,error:{code:'db_denied_or_unavailable'}};
    }
  }};
}
function fixture() {
  const registry=new BridgeRegistry();
  registry.registerDevice({id:DEVICE,ownerId:OWNER,label:'CI TX'});
  registry.setBridgeEnabled({deviceId:DEVICE,ownerId:OWNER,enabled:true});
  registry.setOnline(DEVICE,true);
  const credentials=new BridgeDeviceCredentials();
  const secret=credentials.issue(DEVICE).secret;
  const sessions=new BridgeDeviceSessionGate({registry,credentials});
  const auth=async token=>token==='approved-ci-admin'?
    {id:ADMIN,role:'admin',approved:true}:null;
  const adapter=new BridgePostgresJobsAdapter({rpcClient:rpcClient(),sessions,authenticateAdmin:auth});
  return {adapter,session:sessions.open({deviceId:DEVICE,secret})};
}

test('Node adapter executes real PostgreSQL RPCs, persists completion and honors owner revocation', async ()=>{
  if(process.env.PGDATABASE!=='bridge_test')throw new Error('disposable_database_required');
  // Earlier PostgreSQL contract tests deliberately leave this device OFF.
  await query("update public.bridge_devices set bridge_enabled=true where id='"+DEVICE+"';");
  await query("update public.bridge_grants set revoked_at=null where device_id='"+DEVICE+"' and receiver_id='"+ADMIN+"';");
  // Earlier SQL tests deliberately leave queued jobs behind. Isolate this
  // integration scenario so FIFO cannot select a prior test's job.
  await query("update public.bridge_jobs set state='cancelled', updated_at=clock_timestamp() where device_id='"+DEVICE+"' and state='queued';");

  const f=fixture();
  await assert.rejects(()=>f.adapter.requestList({
    authContext:'unapproved',deviceId:DEVICE,jobId:JOB
  }),/bridge_admin_required/);
  assert.deepEqual(await f.adapter.requestList({
    authContext:'approved-ci-admin',deviceId:DEVICE,jobId:JOB
  }),{jobId:JOB,deviceId:DEVICE,state:'queued'});
  await assert.rejects(()=>f.adapter.pollDevice({
    deviceId:DEVICE,sessionToken:'invalid'
  }),/invalid_device_session/);
  assert.deepEqual(await f.adapter.pollDevice({
    deviceId:DEVICE,sessionToken:f.session.token
  }),{jobId:JOB,deviceId:DEVICE,operation:'list',state:'sent'});
  assert.deepEqual(await f.adapter.completeDevice({
    deviceId:DEVICE,sessionToken:f.session.token,jobId:JOB
  }),{jobId:JOB,deviceId:DEVICE,state:'done'});
  assert.equal(await query("select state from public.bridge_jobs where id='"+JOB+"';"),'done');
  await assert.rejects(()=>f.adapter.completeDevice({
    deviceId:DEVICE,sessionToken:f.session.token,jobId:JOB
  }),/bridge_jobs_database_unavailable/);

  // This is a real DB revocation; the local registry remains deliberately stale.
  await query("update public.bridge_grants set revoked_at=clock_timestamp() where device_id='"+DEVICE+"' and receiver_id='"+ADMIN+"';");
  await assert.rejects(()=>f.adapter.requestList({
    authContext:'approved-ci-admin',deviceId:DEVICE,jobId:DENIED
  }),/bridge_jobs_database_unavailable/);
  assert.equal(await query("select count(*) from public.bridge_jobs where id='"+DENIED+"';"),'0');
  assert.equal(await f.adapter.pollDevice({
    deviceId:DEVICE,sessionToken:f.session.token
  }),null);
});
