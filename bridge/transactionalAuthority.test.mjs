import test from 'node:test';
import assert from 'node:assert/strict';
import { BridgeTransactionalAuthority } from './transactionalAuthority.mjs';
import { BridgeRegistry } from './deviceRouting.mjs';
import { BridgeDeviceCredentials } from './deviceCredentials.mjs';
import { BridgeDeviceSessionGate } from './deviceSessions.mjs';
import { BridgeService } from './bridgeService.mjs';

const TX='tx-a',RX='rx-a';
function fixture() {
  const state={enabled:true,grant:true,approved:true};
  let tail=Promise.resolve();
  function locked(fn) {
    const current=tail.then(fn);
    tail=current.catch(()=>{});
    return current;
  }
  const authority=new BridgeTransactionalAuthority({
    withLockedAuthorization:({deviceId,receiverId,mutate})=>locked(()=>{
      if (deviceId!==TX || receiverId!==RX ||
          !state.enabled || !state.grant || !state.approved)
        throw new Error('bridge_authority_denied');
      return mutate();
    })
  });
  const registry=new BridgeRegistry();
  registry.registerDevice({id:TX,ownerId:'owner',label:'Phone'});
  registry.grant({deviceId:TX,receiverId:RX,approvedByOwnerId:'owner'});
  registry.setBridgeEnabled({deviceId:TX,ownerId:'owner',enabled:true});
  const credentials=new BridgeDeviceCredentials();
  const {secret}=credentials.issue(TX);
  const sessions=new BridgeDeviceSessionGate({registry,credentials});
  const service=new BridgeService({
    registry,sessions,authority,
    authenticateAdmin:async value=>value==='verified'?
      {id:RX,role:'admin',approved:true}:null
  });
  return {state,authority,registry,service,secret,locked};
}

test('transactional authority gates enqueue, TX poll and completion in one locked operation',async ()=>{
  const f=fixture();
  const token=f.service.connectDevice({deviceId:TX,deviceSecret:f.secret}).token;
  assert.equal((await f.service.requestList({
    authContext:'verified',deviceId:TX,jobId:'job'
  })).state,'queued');
  assert.equal((await f.service.pollDevice({deviceId:TX,sessionToken:token})).jobId,'job');
  assert.equal((await f.service.completeDevice({
    deviceId:TX,sessionToken:token,jobId:'job'
  })).state,'done');
});

test('revocation serialized ahead of dispatch blocks pending job despite stale local grant',async ()=>{
  const f=fixture();
  const token=f.service.connectDevice({deviceId:TX,deviceSecret:f.secret}).token;
  await f.service.requestList({authContext:'verified',deviceId:TX,jobId:'pending'});
  await f.locked(()=>{f.state.grant=false;});
  await assert.rejects(()=>f.service.pollDevice({
    deviceId:TX,sessionToken:token
  }),/bridge_authority_denied/);
  assert.equal(f.registry.getJobStatus({jobId:'pending',receiverId:RX}).state,'queued');
});

test('owner OFF serialized before completion blocks result even if local session is online',async ()=>{
  const f=fixture();
  const token=f.service.connectDevice({deviceId:TX,deviceSecret:f.secret}).token;
  await f.service.requestList({authContext:'verified',deviceId:TX,jobId:'claimed'});
  await f.service.pollDevice({deviceId:TX,sessionToken:token});
  await f.locked(()=>{f.state.enabled=false;});
  await assert.rejects(()=>f.service.completeDevice({
    deviceId:TX,sessionToken:token,jobId:'claimed'
  }),/bridge_authority_denied/);
  assert.equal(f.registry.getJobStatus({jobId:'claimed',receiverId:RX}).state,'sent');
});

test('shared lock can serialize a revocation after earlier work but prevent later work',async ()=>{
  const f=fixture();
  const token=f.service.connectDevice({deviceId:TX,deviceSecret:f.secret}).token;
  // Admin authentication is asynchronous: ensure the first operation has
  // completed before scheduling a revocation behind it on the shared lock.
  await f.service.requestList({authContext:'verified',deviceId:TX,jobId:'first'});
  await f.locked(()=>{f.state.grant=false;});
  await assert.rejects(()=>f.service.requestList({
    authContext:'verified',deviceId:TX,jobId:'second'
  }),/bridge_authority_denied/);
  assert.equal(f.registry.getJobStatus({jobId:'first',receiverId:RX}).state,'queued');
  await assert.rejects(()=>f.service.pollDevice({
    deviceId:TX,sessionToken:token
  }),/bridge_authority_denied/);
});

test('authority backend failure denies mutation; no old local permission fallback',async ()=>{
  const f=fixture();
  const broken=new BridgeTransactionalAuthority({
    withLockedAuthorization:async ()=>{throw Error('database_unavailable');}
  });
  f.service.authority=broken;
  await assert.rejects(()=>f.service.requestList({
    authContext:'verified',deviceId:TX,jobId:'failed'
  }),/bridge_authority_unavailable/);
  assert.equal(f.registry.peekNextReceiver(TX),null);
});

test('transaction driver cannot defer, repeat or skip mutation callback',async ()=>{
  let saved;
  const deferred=new BridgeTransactionalAuthority({
    withLockedAuthorization:async ({mutate})=>{saved=mutate; return null;}
  });
  await assert.rejects(()=>deferred.runAuthorized({
    deviceId:TX,receiverId:RX
  },()=>true),/bridge_transaction_not_committed/);
  assert.throws(()=>saved(),/bridge_transaction_invalid/);
  const repeated=new BridgeTransactionalAuthority({
    withLockedAuthorization:async ({mutate})=>{
      mutate();
      return mutate();
    }
  });
  await assert.rejects(()=>repeated.runAuthorized({
    deviceId:TX,receiverId:RX
  },()=>true),/bridge_transaction_invalid/);
});

test('invalid transaction dependencies and async mutations are rejected',async ()=>{
  assert.throws(()=>new BridgeTransactionalAuthority({}),
    /invalid_transactional_authority_dependency/);
  const gate=new BridgeTransactionalAuthority({
    withLockedAuthorization:async ({mutate})=>mutate()
  });
  await assert.rejects(()=>gate.runAuthorized({
    deviceId:TX,receiverId:RX
  },async ()=>1),/bridge_transaction_async_mutation/);
  await assert.rejects(()=>gate.runAuthorized({
    deviceId:null,receiverId:RX
  },()=>1),/bridge_authority_denied/);
});
