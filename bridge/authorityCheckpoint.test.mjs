import test from 'node:test';
import assert from 'node:assert/strict';
import { BridgeAuthorityCheckpoint } from './authorityCheckpoint.mjs';
import { BridgeRegistry } from './deviceRouting.mjs';

const DEVICE='tx-1', RECEIVER='admin-1';
function sharedState() {
  const rows = new Map();
  const key=(d,r)=>JSON.stringify([d,r]);
  rows.set(key(DEVICE,RECEIVER),{
    deviceId:DEVICE,receiverId:RECEIVER,
    bridgeEnabled:true,grantActive:true,receiverApproved:true
  });
  return {
    rows,
    async readAuthorization({deviceId,receiverId}) {
      return rows.get(key(deviceId,receiverId)) ?? null;
    },
    change(patch) {
      const k=key(DEVICE,RECEIVER);
      rows.set(k,{...rows.get(k),...patch});
    }
  };
}

test('fresh authority confirms exactly one enabled approved receiver-device pair',async ()=>{
  const state=sharedState();
  const gate=new BridgeAuthorityCheckpoint({readAuthorization:state.readAuthorization});
  assert.deepEqual(await gate.assertAuthorized({deviceId:DEVICE,receiverId:RECEIVER}),{
    deviceId:DEVICE,receiverId:RECEIVER
  });
  await assert.rejects(()=>gate.assertAuthorized({
    deviceId:DEVICE,receiverId:'someone-else'
  }),/bridge_authority_denied/);
});

test('revocation on shared state is seen by two independent stale local registries',async ()=>{
  const state=sharedState();
  const localA=new BridgeRegistry(), localB=new BridgeRegistry();
  for (const local of [localA,localB]) {
    local.registerDevice({id:DEVICE,ownerId:'owner',label:'TX'});
    local.setBridgeEnabled({deviceId:DEVICE,ownerId:'owner',enabled:true});
    local.grant({deviceId:DEVICE,receiverId:RECEIVER,approvedByOwnerId:'owner'});
    local.setOnline(DEVICE,true);
  }
  const gateA=new BridgeAuthorityCheckpoint({readAuthorization:state.readAuthorization});
  const gateB=new BridgeAuthorityCheckpoint({readAuthorization:state.readAuthorization});
  assert.equal(localB.getDeviceStatus({deviceId:DEVICE,receiverId:RECEIVER}).state,'online');
  await gateA.assertAuthorized({deviceId:DEVICE,receiverId:RECEIVER});
  await gateB.assertAuthorized({deviceId:DEVICE,receiverId:RECEIVER});
  state.change({grantActive:false});
  assert.equal(localB.getDeviceStatus({deviceId:DEVICE,receiverId:RECEIVER}).state,'online');
  await assert.rejects(()=>gateA.assertAuthorized({
    deviceId:DEVICE,receiverId:RECEIVER
  }),/bridge_authority_denied/);
  await assert.rejects(()=>gateB.assertAuthorized({
    deviceId:DEVICE,receiverId:RECEIVER
  }),/bridge_authority_denied/);
});

test('owner OFF and receiver unapproval are checked afresh on every operation',async ()=>{
  const state=sharedState();
  const gate=new BridgeAuthorityCheckpoint({readAuthorization:state.readAuthorization});
  await gate.assertAuthorized({deviceId:DEVICE,receiverId:RECEIVER});
  state.change({bridgeEnabled:false});
  await assert.rejects(()=>gate.assertAuthorized({
    deviceId:DEVICE,receiverId:RECEIVER
  }),/bridge_authority_denied/);
  state.change({bridgeEnabled:true,receiverApproved:false});
  await assert.rejects(()=>gate.assertAuthorized({
    deviceId:DEVICE,receiverId:RECEIVER
  }),/bridge_authority_denied/);
  state.change({receiverApproved:true});
  await gate.assertAuthorized({deviceId:DEVICE,receiverId:RECEIVER});
});

test('database read error is denied rather than granting from stale memory',async ()=>{
  const state=sharedState();
  let offline=false;
  const gate=new BridgeAuthorityCheckpoint({
    readAuthorization:async args=>{
      if (offline) throw Error('database_connection_failed');
      return state.readAuthorization(args);
    }
  });
  await gate.assertAuthorized({deviceId:DEVICE,receiverId:RECEIVER});
  offline=true;
  await assert.rejects(()=>gate.assertAuthorized({
    deviceId:DEVICE,receiverId:RECEIVER
  }),/bridge_authority_unavailable/);
});

test('mismatched or incomplete authority rows cannot approve a request',async ()=>{
  for (const row of [
    null,{}, {deviceId:'another',receiverId:RECEIVER,
      bridgeEnabled:true,grantActive:true,receiverApproved:true},
    {deviceId:DEVICE,receiverId:'another',
      bridgeEnabled:true,grantActive:true,receiverApproved:true},
    {deviceId:DEVICE,receiverId:RECEIVER,
      bridgeEnabled:1,grantActive:true,receiverApproved:true},
    {deviceId:DEVICE,receiverId:RECEIVER,
      bridgeEnabled:true,grantActive:true},
    [DEVICE,RECEIVER]
  ]) {
    const gate=new BridgeAuthorityCheckpoint({readAuthorization:async ()=>row});
    await assert.rejects(()=>gate.assertAuthorized({
      deviceId:DEVICE,receiverId:RECEIVER
    }),/bridge_authority_denied/);
  }
});

test('missing reader and malformed identities fail closed',async ()=>{
  assert.throws(()=>new BridgeAuthorityCheckpoint({}),/invalid_authority_dependency/);
  const gate=new BridgeAuthorityCheckpoint({readAuthorization:async ()=>({
    deviceId:DEVICE,receiverId:RECEIVER,
    bridgeEnabled:true,grantActive:true,receiverApproved:true
  })});
  for(const ids of [{deviceId:null,receiverId:RECEIVER},
    {deviceId:DEVICE,receiverId:''},{deviceId:123,receiverId:RECEIVER}]) {
    await assert.rejects(()=>gate.assertAuthorized(ids),/bridge_authority_denied/);
  }
});
