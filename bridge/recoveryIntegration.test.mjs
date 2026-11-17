import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BridgeRegistry } from './deviceRouting.mjs';
import { BridgeDeviceCredentials } from './deviceCredentials.mjs';
import { BridgeDeviceSessionGate } from './deviceSessions.mjs';
import { BridgeService } from './bridgeService.mjs';
import { LocalBridgeSnapshotStore } from './localSnapshotStore.mjs';
import { createBridgeAdminRequestHandler } from './adminRequestHandler.mjs';
import { createBridgeTxRequestHandler } from './txRequestHandler.mjs';
import { createBridgeLoopbackTestServer } from './loopbackHttp.mjs';

const TX='11111111-1111-4111-8111-111111111111';
const RX='22222222-2222-4222-8222-222222222222';
const SENT='33333333-3333-4333-8333-333333333333';
const PENDING='44444444-4444-4444-8444-444444444444';
const AFTER='55555555-5555-4555-8555-555555555555';
const AUTH='Bearer '+'a'.repeat(32);

function serviceFor(registry,credentials) {
  const sessions=new BridgeDeviceSessionGate({registry,credentials});
  const service=new BridgeService({
    registry,sessions,
    authenticateAdmin:async context =>
      context?.accessToken==='a'.repeat(32) ?
        {id:RX,role:'admin',approved:true}:null
  });
  const admin=createBridgeAdminRequestHandler({service,newJobId:()=>AFTER});
  const tx=createBridgeTxRequestHandler({service});
  return {service,sessions,admin,tx};
}
async function post(url,path,body,auth=false) {
  const response=await fetch(url+path,{
    method:'POST',
    headers:{'content-type':'application/json',
      ...(auth?{authorization:AUTH}:{})},
    body:JSON.stringify(body)
  });
  return {status:response.status,body:await response.json()};
}

test('cold restart restores consent and verifier, not online status, token, or jobs',async t=>{
  const folder=await mkdtemp(join(tmpdir(),'bridge-restart-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const store=new LocalBridgeSnapshotStore(join(folder,'registry.json'));
  const before=await store.load();
  before.registerDevice({id:TX,ownerId:'owner',label:'Owned TX'});
  before.setBridgeEnabled({deviceId:TX,ownerId:'owner',enabled:true});
  before.grant({deviceId:TX,receiverId:RX,approvedByOwnerId:'owner'});
  const oldCredentials=new BridgeDeviceCredentials();
  const issued=oldCredentials.issue(TX);
  const verifier=oldCredentials.exportVerifier(TX);
  const old=serviceFor(before,oldCredentials);
  const oldToken=old.service.connectDevice({
    deviceId:TX,deviceSecret:issued.secret
  }).token;
  before.enqueue({jobId:SENT,deviceId:TX,receiverId:RX,operation:'list'});
  before.enqueue({jobId:PENDING,deviceId:TX,receiverId:RX,operation:'list'});
  assert.equal(old.service.pollDevice({deviceId:TX,sessionToken:oldToken}).jobId,SENT);
  await store.save(before);

  const restored=await new LocalBridgeSnapshotStore(join(folder,'registry.json')).load();
  assert.equal(restored.getDeviceStatus({deviceId:TX,receiverId:RX}).state,'offline');
  assert.equal(restored.listApproved(RX).length,1);
  const credentials=new BridgeDeviceCredentials();
  credentials.importTrustedVerifier(verifier);
  const fresh=serviceFor(restored,credentials);
  const server=createBridgeLoopbackTestServer({handler:fresh.admin,txHandler:fresh.tx});
  const url=await server.start();t.after(()=>server.stop());

  assert.equal((await post(url,'/bridge/tx/poll',{
    deviceId:TX,sessionToken:oldToken
  })).status,403);
  assert.equal((await post(url,'/bridge/admin/list',{
    deviceId:TX
  },true)).status,409);
  const opened=await post(url,'/bridge/tx/connect',{
    deviceId:TX,deviceSecret:issued.secret
  });
  assert.equal(opened.status,200);
  assert.notEqual(opened.body.token,oldToken);
  assert.equal((await post(url,'/bridge/tx/poll',{
    deviceId:TX,sessionToken:opened.body.token
  })).body.job,null);
  assert.equal((await post(url,'/bridge/tx/complete',{
    deviceId:TX,sessionToken:opened.body.token,jobId:SENT
  })).status,403);
  assert.equal((await post(url,'/bridge/admin/status',{
    jobId:PENDING
  },true)).status,404);
  assert.equal((await post(url,'/bridge/admin/list',{
    deviceId:TX
  },true)).status,202);
  assert.equal((await post(url,'/bridge/tx/poll',{
    deviceId:TX,sessionToken:opened.body.token
  })).body.job.jobId,AFTER);
});

test('restarted registry preserves owner OFF and revoked permission',async t=>{
  const folder=await mkdtemp(join(tmpdir(),'bridge-restart-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const store=new LocalBridgeSnapshotStore(join(folder,'registry.json'));
  const r=await store.load();
  r.registerDevice({id:TX,ownerId:'owner',label:'Owned TX'});
  r.grant({deviceId:TX,receiverId:RX,approvedByOwnerId:'owner'});
  r.revoke({deviceId:TX,receiverId:RX,approvedByOwnerId:'owner'});
  await store.save(r);
  const restored=await new LocalBridgeSnapshotStore(join(folder,'registry.json')).load();
  assert.equal(restored.isDeviceEnabled(TX),false);
  assert.equal(restored.listApproved(RX).length,0);
  const creds=new BridgeDeviceCredentials();
  const secret=creds.issue(TX).secret;
  assert.throws(()=>serviceFor(restored,creds).service.connectDevice({
    deviceId:TX,deviceSecret:secret
  }),/bridge_unavailable/);
});

test('corrupt persisted grants never turn into an empty trusted registry',async t=>{
  const folder=await mkdtemp(join(tmpdir(),'bridge-restart-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const file=join(folder,'registry.json');
  const {writeFile}=await import('node:fs/promises');
  await writeFile(file,JSON.stringify({
    version:1,
    devices:[{id:TX,ownerId:'owner',label:'Owned TX',bridgeEnabled:true}],
    grants:[{deviceId:'missing',receiverId:RX}]
  }));
  await assert.rejects(()=>new LocalBridgeSnapshotStore(file).load(),
    /invalid_snapshot/);
});
