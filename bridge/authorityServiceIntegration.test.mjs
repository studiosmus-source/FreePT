import test from 'node:test';
import assert from 'node:assert/strict';
import { BridgeAuthorityCheckpoint } from './authorityCheckpoint.mjs';
import { BridgeRegistry } from './deviceRouting.mjs';
import { BridgeDeviceCredentials } from './deviceCredentials.mjs';
import { BridgeDeviceSessionGate } from './deviceSessions.mjs';
import { BridgeService } from './bridgeService.mjs';
import { createBridgeAdminRequestHandler } from './adminRequestHandler.mjs';
import { createBridgeTxRequestHandler } from './txRequestHandler.mjs';

const DEVICE='11111111-1111-4111-8111-111111111111';
const ADMIN='22222222-2222-4222-8222-222222222222';
const JOB='33333333-3333-4333-8333-333333333333';
const NEXT='44444444-4444-4444-8444-444444444444';
const TOKEN='x'.repeat(32);
function setup() {
  const state={bridgeEnabled:true,grantActive:true,receiverApproved:true,offline:false,reads:0};
  const registry=new BridgeRegistry();
  registry.registerDevice({id:DEVICE,ownerId:'owner',label:'TX'});
  registry.grant({deviceId:DEVICE,receiverId:ADMIN,approvedByOwnerId:'owner'});
  registry.setBridgeEnabled({deviceId:DEVICE,ownerId:'owner',enabled:true});
  const credentials=new BridgeDeviceCredentials();
  const {secret}=credentials.issue(DEVICE);
  const sessions=new BridgeDeviceSessionGate({registry,credentials});
  const authority=new BridgeAuthorityCheckpoint({readAuthorization:async ({deviceId,receiverId})=>{
    state.reads++;
    if(state.offline) throw Error('db_down');
    return {deviceId,receiverId,bridgeEnabled:state.bridgeEnabled,
      grantActive:state.grantActive,receiverApproved:state.receiverApproved};
  }});
  const service=new BridgeService({registry,sessions,authority,
    authenticateAdmin:async ctx=>ctx?.accessToken===TOKEN ?
      {id:ADMIN,role:'admin',approved:true}:null});
  const admin=createBridgeAdminRequestHandler({service,newJobId:()=>JOB});
  const tx=createBridgeTxRequestHandler({service});
  const authContext={accessToken:TOKEN};
  const connect=()=>service.connectDevice({deviceId:DEVICE,deviceSecret:secret});
  const queue=(id=JOB)=>service.requestList({authContext,deviceId:DEVICE,jobId:id});
  return {state,registry,service,admin,tx,connect,queue,authContext};
}

test('authority is checked for request, poll and completion, never cached',async ()=>{
  const f=setup();
  const session=f.connect();
  await f.queue();
  const job=await f.service.pollDevice({deviceId:DEVICE,sessionToken:session.token});
  assert.equal(job.jobId,JOB);
  assert.equal((await f.service.completeDevice({
    deviceId:DEVICE,sessionToken:session.token,jobId:JOB
  })).state,'done');
  assert.equal(f.state.reads,3);
});

test('authoritative revocation before admin enqueue denies stale local grant',async ()=>{
  const f=setup();
  f.connect();
  f.state.grantActive=false;
  await assert.rejects(()=>f.queue(),/bridge_authority_denied/);
  assert.equal(f.registry.peekNextReceiver(DEVICE),null);
});

test('authoritative revocation after queue denies TX dispatch',async ()=>{
  const f=setup();
  const session=f.connect();
  await f.queue();
  f.state.grantActive=false;
  await assert.rejects(()=>f.service.pollDevice({
    deviceId:DEVICE,sessionToken:session.token
  }),/bridge_authority_denied/);
  assert.equal(f.registry.getJobStatus({jobId:JOB,receiverId:ADMIN}).state,'queued');
  f.state.grantActive=true;
  assert.equal((await f.service.pollDevice({
    deviceId:DEVICE,sessionToken:session.token
  })).jobId,JOB);
});

test('authoritative owner OFF after dispatch denies TX completion',async ()=>{
  const f=setup();
  const session=f.connect();
  await f.queue();
  await f.service.pollDevice({deviceId:DEVICE,sessionToken:session.token});
  f.state.bridgeEnabled=false;
  await assert.rejects(()=>f.service.completeDevice({
    deviceId:DEVICE,sessionToken:session.token,jobId:JOB
  }),/bridge_authority_denied/);
  assert.equal(f.registry.getJobStatus({jobId:JOB,receiverId:ADMIN}).state,'sent');
});

test('authority outage fails closed on enqueue, dispatch and completion',async ()=>{
  const f=setup();
  const session=f.connect();
  f.state.offline=true;
  await assert.rejects(()=>f.queue(),/bridge_authority_unavailable/);
  f.state.offline=false;
  await f.queue();
  f.state.offline=true;
  await assert.rejects(()=>f.service.pollDevice({
    deviceId:DEVICE,sessionToken:session.token
  }),/bridge_authority_unavailable/);
  f.state.offline=false;
  await f.service.pollDevice({deviceId:DEVICE,sessionToken:session.token});
  f.state.offline=true;
  await assert.rejects(()=>f.service.completeDevice({
    deviceId:DEVICE,sessionToken:session.token,jobId:JOB
  }),/bridge_authority_unavailable/);
});

test('HTTP admin and TX contract awaits authoritative failures and successes',async ()=>{
  const f=setup();
  const adminCall=body=>f.admin({method:'POST',path:'/bridge/admin/list',
    headers:{authorization:'Bearer '+TOKEN},body});
  const txCall=(path,body)=>f.tx({method:'POST',path,body});
  const session=f.connect();
  f.state.grantActive=false;
  assert.deepEqual(await adminCall({deviceId:DEVICE}),{
    status:500,body:{error:'bridge_unavailable'}
  });
  f.state.grantActive=true;
  assert.equal((await adminCall({deviceId:DEVICE})).status,202);
  f.state.offline=true;
  assert.equal((await txCall('/bridge/tx/poll',{
    deviceId:DEVICE,sessionToken:session.token
  })).status,403);
  f.state.offline=false;
  assert.equal((await txCall('/bridge/tx/poll',{
    deviceId:DEVICE,sessionToken:session.token
  })).body.job.jobId,JOB);
  f.state.receiverApproved=false;
  assert.equal((await txCall('/bridge/tx/complete',{
    deviceId:DEVICE,sessionToken:session.token,jobId:JOB
  })).status,403);
});

test('queue changes during authority read cannot dispatch a different job',async ()=>{
  const f=setup();
  const session=f.connect();
  await f.queue();
  let release;
  const pending=new Promise(resolve=>{release=resolve;});
  // Replace the authorized checkpoint on this service with a controlled delay.
  f.service.authority={assertAuthorized:async ()=>{await pending;}};
  const polling=f.service.pollDevice({deviceId:DEVICE,sessionToken:session.token});
  f.registry.cancelJob({jobId:JOB,receiverId:ADMIN});
  f.registry.enqueue({jobId:NEXT,deviceId:DEVICE,receiverId:ADMIN,operation:'list'});
  release();
  await assert.rejects(()=>polling,/bridge_authority_retry/);
  assert.equal(f.registry.getJobStatus({jobId:NEXT,receiverId:ADMIN}).state,'queued');
});

test('invalid authority dependency does not silently enable unguarded mode',()=>{
  const f=setup();
  assert.throws(()=>new BridgeService({
    registry:f.registry,sessions:f.service.sessions,
    authenticateAdmin:async()=>null,authority:{}
  }),/invalid_bridge_authority_dependency/);
});
