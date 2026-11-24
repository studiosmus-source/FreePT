import test from 'node:test';
import assert from 'node:assert/strict';
import {createBridgeOwnerControls} from '../src/bridgeOwnerControls.js';
const OWNER='11111111-1111-4111-8111-111111111111';
const DEVICE='22222222-2222-4222-8222-222222222222';
function fixture({exists=false,error=null,login=true}={}){
 let cleared=0;
 const creds={status:async()=>({provisioned:true,deviceId:DEVICE}),
   clear:async()=>{cleared++;return {cleared:true}}};
 const db={from:table=>{
  assert.equal(table,'bridge_devices');
  return {select:()=>({eq:()=>({eq:()=>({
   maybeSingle:async()=>({data:exists?{id:DEVICE,owner_id:OWNER}:null,error})
  })})})};
 },rpc:async()=>{throw Error('no RPC needed')}};
 const auth={getSession:async()=>({data:{session:login?{access_token:'a'.repeat(40),user:{id:OWNER}}:null}})};
 const c=createBridgeOwnerControls({db,auth,credentials:creds});
 return {c,getCleared:()=>cleared};
}
test('missing server device clears only the selected local orphan',async()=>{
 const f=fixture();
 assert.equal(await f.c.recoverMissingDevice(DEVICE),true);
 assert.equal(f.getCleared(),1);
});
test('valid registered device is never reset',async()=>{
 const f=fixture({exists:true});
 assert.equal(await f.c.recoverMissingDevice(DEVICE),false);
 assert.equal(f.getCleared(),0);
});
test('database failure is not mistaken for a missing device',async()=>{
 const f=fixture({error:{message:'connection failed'}});
 await assert.rejects(()=>f.c.recoverMissingDevice(DEVICE),/device_unavailable/);
 assert.equal(f.getCleared(),0);
});
test('unauthenticated session and invalid id cannot erase keys',async()=>{
 const f=fixture({login:false});
 await assert.rejects(()=>f.c.recoverMissingDevice(DEVICE),/login_required/);
 await assert.rejects(()=>f.c.recoverMissingDevice('invalid'),/invalid_control/);
 assert.equal(f.getCleared(),0);
});
