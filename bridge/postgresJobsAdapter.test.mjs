import test from 'node:test';
import assert from 'node:assert/strict';
import { BridgePostgresJobsAdapter } from './postgresJobsAdapter.mjs';
const DEVICE='11111111-1111-4111-8111-111111111111';
const ADMIN='22222222-2222-4222-8222-222222222222';
const JOB='33333333-3333-4333-8333-333333333333';
const BIND='f'.repeat(64);

function fixture() {
  const calls=[];
  const db={rpc:async (name,args)=>{
    calls.push({name,args});
    if(name==='bridge_server_enqueue_list')return {data:args.p_job_id,error:null};
    if(name==='bridge_server_claim_list')return {data:JOB,error:null};
    if(name==='bridge_server_complete_list')return {data:true,error:null};
    throw Error('unexpected rpc');
  }};
  const sessions={getDispatchBinding:({deviceId,token})=>{
    if(deviceId!==DEVICE||token!=='verified-tx') throw Error('invalid_device_session');
    return BIND;
  }};
  const auth=async ctx=>ctx==='verified-admin'?
    {id:ADMIN,role:'admin',approved:true}:null;
  const service=new BridgePostgresJobsAdapter({
    rpcClient:db,sessions,authenticateAdmin:auth
  });
  return {calls,db,sessions,service,auth};
}
test('verified admin queues list job only through trusted DB RPC',async ()=>{
  const f=fixture();
  assert.deepEqual(await f.service.requestList({
    authContext:'verified-admin',deviceId:DEVICE,jobId:JOB
  }),{jobId:JOB,deviceId:DEVICE,state:'queued'});
  assert.deepEqual(f.calls,[{name:'bridge_server_enqueue_list',
    args:{p_job_id:JOB,p_device_id:DEVICE,p_receiver_id:ADMIN}}]);
});

test('TX polls and completes only after server-validated session binding',async ()=>{
  const f=fixture();
  assert.deepEqual(await f.service.pollDevice({
    deviceId:DEVICE,sessionToken:'verified-tx'
  }),{jobId:JOB,deviceId:DEVICE,operation:'list',state:'sent'});
  assert.deepEqual(await f.service.completeDevice({
    deviceId:DEVICE,sessionToken:'verified-tx',jobId:JOB
  }),{jobId:JOB,deviceId:DEVICE,state:'done'});
  assert.deepEqual(f.calls,[
    {name:'bridge_server_claim_list',args:{p_device_id:DEVICE,p_session_binding_hex:BIND}},
    {name:'bridge_server_complete_list',args:{
      p_job_id:JOB,p_device_id:DEVICE,p_session_binding_hex:BIND
    }}
  ]);
});

test('missing admin authorization never reaches database',async ()=>{
  const f=fixture();
  await assert.rejects(()=>f.service.requestList({
    authContext:'spoofed',deviceId:DEVICE,jobId:JOB
  }),/bridge_admin_required/);
  assert.equal(f.calls.length,0);
});

test('wrong TX token and malformed identifiers never reach database',async ()=>{
  const f=fixture();
  await assert.rejects(()=>f.service.pollDevice({
    deviceId:DEVICE,sessionToken:'wrong'
  }),/invalid_device_session/);
  await assert.rejects(()=>f.service.completeDevice({
    deviceId:DEVICE,sessionToken:'wrong',jobId:JOB
  }),/invalid_device_session/);
  await assert.rejects(()=>f.service.requestList({
    authContext:'verified-admin',deviceId:'not-uuid',jobId:JOB
  }),/bridge_invalid_identity/);
  assert.equal(f.calls.length,0);
});

test('empty queue is null and malformed DB responses fail closed',async ()=>{
  const f=fixture();
  f.db.rpc=async ()=>({data:null,error:null});
  assert.equal(await f.service.pollDevice({
    deviceId:DEVICE,sessionToken:'verified-tx'
  }),null);
  await assert.rejects(()=>f.service.requestList({
    authContext:'verified-admin',deviceId:DEVICE,jobId:JOB
  }),/bridge_jobs_invalid_response/);
  await assert.rejects(()=>f.service.completeDevice({
    deviceId:DEVICE,sessionToken:'verified-tx',jobId:JOB
  }),/bridge_jobs_invalid_response/);
  f.db.rpc=async ()=>({data:{jobId:JOB},error:null});
  await assert.rejects(()=>f.service.pollDevice({
    deviceId:DEVICE,sessionToken:'verified-tx'
  }),/bridge_jobs_invalid_response/);
});

test('RPC rejected response and thrown exception fail closed',async ()=>{
  const f=fixture();
  f.db.rpc=async ()=>({data:null,error:{code:'42501'}});
  await assert.rejects(()=>f.service.requestList({
    authContext:'verified-admin',deviceId:DEVICE,jobId:JOB
  }),/bridge_jobs_database_unavailable/);
  f.db.rpc=async ()=>{throw Error('network down')};
  await assert.rejects(()=>f.service.pollDevice({
    deviceId:DEVICE,sessionToken:'verified-tx'
  }),/bridge_jobs_database_unavailable/);
});

test('untrusted injected dependencies are rejected',()=>{
  const f=fixture();
  assert.throws(()=>new BridgePostgresJobsAdapter({
    rpcClient:{},sessions:f.sessions,authenticateAdmin:f.auth
  }),/invalid_postgres_jobs_dependencies/);
  assert.throws(()=>new BridgePostgresJobsAdapter({
    rpcClient:f.db,sessions:{},authenticateAdmin:f.auth
  }),/invalid_postgres_jobs_dependencies/);
});

test('staging adapter never assumes local registry job persistence',async ()=>{
  const f=fixture();
  assert.equal('registry' in f.service,false);
  assert.equal('connectDevice' in f.service,false);
  assert.equal('cancelRequest' in f.service,false);
  assert.equal('getRequestStatus' in f.service,false);
});
