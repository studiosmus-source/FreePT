import test from 'node:test';
import assert from 'node:assert/strict';
import { createBridgeTxRequestHandler } from './txRequestHandler.mjs';
import { createBridgeLoopbackTestServer } from './loopbackHttp.mjs';
import { createBridgeAdminRequestHandler } from './adminRequestHandler.mjs';
import { BridgeRegistry } from './deviceRouting.mjs';
import { BridgeDeviceCredentials } from './deviceCredentials.mjs';
import { BridgeDeviceSessionGate } from './deviceSessions.mjs';
import { BridgeService } from './bridgeService.mjs';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const ADMIN = '33333333-3333-4333-8333-333333333333';
const JOB = '44444444-4444-4444-8444-444444444444';
const AUTH = 'Bearer ' + 'a'.repeat(40);

function fixture() {
  const registry = new BridgeRegistry();
  const credentials = new BridgeDeviceCredentials();
  const secrets = {};
  for (const [id, owner] of [[A,'owner-a'],[B,'owner-b']]) {
    registry.registerDevice({id,ownerId:owner,label:id});
    registry.setBridgeEnabled({deviceId:id,ownerId:owner,enabled:true});
    registry.grant({deviceId:id,receiverId:ADMIN,approvedByOwnerId:owner});
    secrets[id] = credentials.issue(id).secret;
  }
  const sessions=new BridgeDeviceSessionGate({registry,credentials});
  const service=new BridgeService({
    registry,sessions,
    authenticateAdmin:async ctx=>ctx?.accessToken==='a'.repeat(40) ?
      {id:ADMIN,role:'admin',approved:true}:null
  });
  const admin=createBridgeAdminRequestHandler({service,newJobId:()=>JOB});
  const tx=createBridgeTxRequestHandler({service});
  return {registry,secrets,sessions,service,admin,tx};
}

async function post(url,path,body,headers={}) {
  const response = await fetch(url+path,{
    method:'POST',headers:{'content-type':'application/json',...headers},
    body:JSON.stringify(body)
  });
  return {status:response.status,body:await response.json()};
}

test('real loopback HTTP: admin and TX exchange a job across distinct routes',async t=>{
  const f=fixture();
  const srv=createBridgeLoopbackTestServer({handler:f.admin,txHandler:f.tx});
  const url=await srv.start();t.after(()=>srv.stop());
  const connect=await post(url,'/bridge/tx/connect',{deviceId:A,deviceSecret:f.secrets[A]});
  assert.equal(connect.status,200);
  assert.match(connect.body.token,/^[0-9a-f]{64}$/);
  assert.equal(f.registry.getDeviceStatus({deviceId:A,receiverId:ADMIN}).state,'online');
  const queued=await post(url,'/bridge/admin/list',{deviceId:A},{authorization:AUTH});
  assert.equal(queued.status,202);
  assert.equal(queued.body.jobId,JOB);
  const poll=await post(url,'/bridge/tx/poll',{deviceId:A,sessionToken:connect.body.token});
  assert.equal(poll.status,200);
  assert.equal(poll.body.job.jobId,JOB);
  const done=await post(url,'/bridge/tx/complete',{
    deviceId:A,sessionToken:connect.body.token,jobId:JOB
  });
  assert.equal(done.status,200);
  assert.equal(done.body.state,'done');
  const final=await post(url,'/bridge/admin/status',{jobId:JOB},{authorization:AUTH});
  assert.equal(final.body.state,'done');
});

test('wrong device token and incorrect session never take or complete work',async t=>{
  const f=fixture();
  const srv=createBridgeLoopbackTestServer({handler:f.admin,txHandler:f.tx});
  const url=await srv.start();t.after(()=>srv.stop());
  const a=(await post(url,'/bridge/tx/connect',{deviceId:A,deviceSecret:f.secrets[A]})).body.token;
  const b=(await post(url,'/bridge/tx/connect',{deviceId:B,deviceSecret:f.secrets[B]})).body.token;
  await post(url,'/bridge/admin/list',{deviceId:A},{authorization:AUTH});
  assert.equal((await post(url,'/bridge/tx/poll',{deviceId:A,sessionToken:b})).status,403);
  assert.equal((await post(url,'/bridge/tx/poll',{deviceId:B,sessionToken:b})).body.job,null);
  assert.equal((await post(url,'/bridge/tx/poll',{deviceId:A,sessionToken:a})).body.job.jobId,JOB);
  assert.equal((await post(url,'/bridge/tx/complete',{
    deviceId:A,sessionToken:b,jobId:JOB
  })).status,403);
  assert.equal((await post(url,'/bridge/tx/complete',{
    deviceId:A,sessionToken:a,jobId:JOB
  })).body.state,'done');
});

test('invalid secret and owner shutdown deny TX connection without online presence',async t=>{
  const f=fixture();
  const srv=createBridgeLoopbackTestServer({handler:f.admin,txHandler:f.tx});
  const url=await srv.start();t.after(()=>srv.stop());
  assert.equal((await post(url,'/bridge/tx/connect',{
    deviceId:A,deviceSecret:f.secrets[B]
  })).status,403);
  assert.equal(f.registry.getDeviceStatus({deviceId:A,receiverId:ADMIN}).state,'offline');
  f.registry.setBridgeEnabled({deviceId:A,ownerId:'owner-a',enabled:false});
  assert.equal((await post(url,'/bridge/tx/connect',{
    deviceId:A,deviceSecret:f.secrets[A]
  })).status,403);
  assert.equal(f.registry.getDeviceStatus({deviceId:A,receiverId:ADMIN}).state,'closed_by_owner');
});

test('TX contract rejects unapproved fields, malformed tokens and unknown operations',async t=>{
  const f=fixture();
  const srv=createBridgeLoopbackTestServer({handler:f.admin,txHandler:f.tx});
  const url=await srv.start();t.after(()=>srv.stop());
  assert.equal((await post(url,'/bridge/tx/connect',{
    deviceId:A,deviceSecret:f.secrets[A],receiverId:ADMIN
  })).status,400);
  assert.equal((await post(url,'/bridge/tx/poll',{
    deviceId:A,sessionToken:'not-a-token'
  })).status,400);
  assert.equal((await post(url,'/bridge/tx/read',{deviceId:A})).status,404);
  assert.equal(f.registry.getDeviceStatus({deviceId:A,receiverId:ADMIN}).state,'offline');
});

test('TX routes remain unavailable when test server is instantiated admin-only',async t=>{
  const f=fixture();
  const srv=createBridgeLoopbackTestServer({handler:f.admin});
  const url=await srv.start();t.after(()=>srv.stop());
  assert.equal((await post(url,'/bridge/tx/connect',{
    deviceId:A,deviceSecret:f.secrets[A]
  })).status,404);
});

test('TX request handler fails closed without trusted service',()=>{
  assert.throws(()=>createBridgeTxRequestHandler({}),/invalid_tx_request_dependencies/);
});
