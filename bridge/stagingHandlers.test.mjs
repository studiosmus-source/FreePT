import test from 'node:test';
import assert from 'node:assert/strict';
import { createBridgeStagingHandlers } from './stagingHandlers.mjs';

const DEVICE='11111111-1111-4111-8111-111111111111';
const ADMIN='22222222-2222-4222-8222-222222222222';
const JOB='33333333-3333-4333-8333-333333333333';
const ACCESS='a'.repeat(32);
const SECRET='b'.repeat(64);
const VERIFIER='c'.repeat(64);
const headers={authorization:'Bearer '+ACCESS};

function setup({role='admin',status='approved',allowDevice=true}={}){
  const calls=[];
  const authClient={auth:{async getUser(token){
    return token===ACCESS
      ? {data:{user:{id:ADMIN,is_anonymous:false}},error:null}
      : {data:{user:null},error:{message:'invalid'}};
  }}};
  const profilesClient={from(name){
    assert.equal(name,'profiles');
    return {select(cols){
      assert.equal(cols,'id,role,status');
      return {eq(field,id){
        assert.equal(field,'id');assert.equal(id,ADMIN);
        return {async maybeSingle(){
          return {data:{id:ADMIN,role,status},error:null};
        }};
      }};
    }};
  }};
  let queued=false;
  const rpcClient={async rpc(name,args){
    calls.push({name,args});
    if(name==='bridge_server_enqueue_list'){
      queued=true;
      return {data:args.p_job_id,error:null};
    }
    if(name==='bridge_server_job_status')
      return {data:{jobId:JOB,deviceId:DEVICE,state:queued?'queued':'cancelled'},error:null};
    if(name==='bridge_server_cancel_job'){
      queued=false;
      return {data:{jobId:JOB,deviceId:DEVICE,state:'cancelled'},error:null};
    }
    if(name==='bridge_server_open_tx_session')
      return allowDevice?{data:new Date(Date.now()+60_000).toISOString(),error:null}:
        {data:null,error:{code:'42501'}};
    if(name==='bridge_server_assert_tx_session')
      return {data:args.p_token_hash_hex,error:null};
    if(name==='bridge_server_claim_list')
      return {data:queued?JOB:null,error:null};
    if(name==='bridge_server_complete_list')
      return {data:queued,error:null};
    throw new Error('Unexpected RPC '+name);
  }};
  const handlers=createBridgeStagingHandlers({
    authClient,profilesClient,rpcClient,
    authenticateDevice:async({deviceId,deviceSecret})=>
      deviceId===DEVICE&&deviceSecret===SECRET&&allowDevice
        ? {verifierHex:VERIFIER}:null,
    newJobId:()=>JOB
  });
  return {calls,...handlers};
}
const admin=(handler,path,body,auth=headers)=>
  handler({method:'POST',path:'/bridge/admin/'+path,body,headers:auth});
const tx=(handler,path,body)=>
  handler({method:'POST',path:'/bridge/tx/'+path,body});

test('staging admin validates Supabase role and queues only via persistent RPC',async()=>{
  const f=setup();
  const result=await admin(f.adminHandler,'list',{deviceId:DEVICE});
  assert.equal(result.status,202);
  assert.equal(result.body.jobId,JOB);
  assert.deepEqual(f.calls.map(x=>x.name),['bridge_server_enqueue_list']);
  assert.equal(f.calls[0].args.p_receiver_id,ADMIN);
});

test('staging denies unapproved admin without database mutation',async()=>{
  const f=setup({role:'user'});
  assert.equal((await admin(f.adminHandler,'list',{deviceId:DEVICE})).status,403);
  assert.equal((await admin(f.adminHandler,'status',{jobId:JOB})).status,403);
  assert.equal(f.calls.length,0);
});

test('staging TX verifies secret, establishes bound session and completes queued job',async()=>{
  const f=setup();
  assert.equal((await admin(f.adminHandler,'list',{deviceId:DEVICE})).status,202);
  const conn=await tx(f.txHandler,'connect',{deviceId:DEVICE,deviceSecret:SECRET});
  assert.equal(conn.status,200);
  assert.match(conn.body.token,/^[0-9a-f]{64}$/);
  const poll=await tx(f.txHandler,'poll',{deviceId:DEVICE,sessionToken:conn.body.token});
  assert.equal(poll.status,200);
  assert.equal(poll.body.job.jobId,JOB);
  const done=await tx(f.txHandler,'complete',{
    deviceId:DEVICE,sessionToken:conn.body.token,jobId:JOB
  });
  assert.equal(done.status,200);
  assert.equal(done.body.state,'done');
  assert.deepEqual(f.calls.map(x=>x.name),[
    'bridge_server_enqueue_list','bridge_server_open_tx_session',
    'bridge_server_assert_tx_session','bridge_server_claim_list',
    'bridge_server_assert_tx_session','bridge_server_complete_list'
  ]);
});

test('staging rejects unknown TX and leaves admin state unchanged',async()=>{
  const f=setup();
  const attempt=await tx(f.txHandler,'connect',{deviceId:DEVICE,deviceSecret:'f'.repeat(64)});
  assert.equal(attempt.status,403);
  assert.equal(f.calls.length,0);
});

test('staging rejects incomplete server dependencies and creates no listener',()=>{
  assert.throws(()=>createBridgeStagingHandlers({
    authClient:{},profilesClient:{},rpcClient:{},authenticateDevice:()=>null
  }),/invalid_bridge_staging_dependencies/);
  const f=setup();
  assert.deepEqual(Object.keys(f).filter(k=>k.endsWith('Handler')).sort(),
    ['adminHandler','txHandler']);
  assert.equal('listen' in f.adminHandler,false);
});
