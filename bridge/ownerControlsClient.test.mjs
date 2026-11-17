import test from 'node:test';
import assert from 'node:assert/strict';
import {createBridgeOwnerControls} from '../src/bridgeOwnerControls.js';
const OWNER='11111111-1111-4111-8111-111111111111';
const DEVICE='22222222-2222-4222-8222-222222222222';
const ADMIN='33333333-3333-4333-8333-333333333333';
function fixture({owner=OWNER,fail=false}={}){
  const calls=[];
  const db={
    from(table){
      calls.push({table});
      if(table==='bridge_devices')return {select:()=>({eq:()=>({eq:()=>({
        maybeSingle:async()=>({data:fail?null:{id:DEVICE,owner_id:owner,bridge_enabled:false},error:null})
      })})})};
      if(table==='bridge_grants')return {select:()=>({eq:()=>({
        limit:async()=>({data:[{receiver_id:ADMIN,revoked_at:null}],error:null})
      })})};
      throw Error('wrong_table');
    },
    async rpc(name,args){calls.push({name,args});return {data:null,error:null};}
  };
  const auth={getSession:async()=>({data:{session:{
    access_token:'a'.repeat(40),user:{id:OWNER}
  }}})};
  return {client:createBridgeOwnerControls({db,auth}),calls};
}
test('owner turns on, authorizes a specific admin and revokes without direct table writes',async()=>{
  const f=fixture();
  assert.equal(await f.client.setEnabled(DEVICE,true),true);
  await f.client.grant(DEVICE,ADMIN);
  await f.client.revoke(DEVICE,ADMIN);
  await f.client.setEnabled(DEVICE,false);
  assert.deepEqual(f.calls.filter(x=>x.name).map(x=>[x.name,x.args]),[
    ['bridge_owner_set_enabled',{p_device_id:DEVICE,p_enabled:true}],
    ['bridge_owner_grant',{p_device_id:DEVICE,p_receiver_id:ADMIN}],
    ['bridge_owner_revoke',{p_device_id:DEVICE,p_receiver_id:ADMIN}],
    ['bridge_owner_set_enabled',{p_device_id:DEVICE,p_enabled:false}]
  ]);
  assert.equal(f.calls.some(x=>x.name?.includes('service_role')),false);
});
test('owner reads only own device and grants',async()=>{
  const f=fixture();
  assert.deepEqual(await f.client.device(DEVICE),{enabled:false});
  assert.deepEqual(await f.client.recipients(DEVICE),[{receiverId:ADMIN,active:true}]);
});
test('bad identities and foreign device abort before any privileged RPC',async()=>{
  const f=fixture({owner:ADMIN});
  await assert.rejects(()=>f.client.grant(DEVICE,ADMIN),/device_unavailable/);
  assert.equal(f.calls.some(x=>x.name),false);
  await assert.rejects(()=>f.client.setEnabled('invalid',true),/invalid_control/);
  await assert.rejects(()=>f.client.revoke(DEVICE,'invalid'),/invalid_control/);
});
test('closed session and RPC errors fail closed',async()=>{
  const f=fixture();
  const db={from:()=>({select:()=>({eq:()=>({eq:()=>({
    maybeSingle:async()=>({data:{id:DEVICE,owner_id:OWNER,bridge_enabled:false}})
  })})})}),rpc:async()=>({error:{code:'42501'}})};
  const auth={getSession:async()=>({data:{session:{
    access_token:'a'.repeat(40),user:{id:OWNER}
  }}})};
  const client=createBridgeOwnerControls({db,auth});
  await assert.rejects(()=>client.setEnabled(DEVICE,true),/control_denied/);
  const noAuth=createBridgeOwnerControls({db,auth:{getSession:async()=>({data:{session:null}})}});
  await assert.rejects(()=>noAuth.device(DEVICE),/login_required/);
  assert.equal(f.calls.length,0);
});

test('family activation uses one owner-scoped server RPC, never recipient ids from the screen',async()=>{
  const calls=[];
  const db={
    from(table){
      assert.equal(table,'bridge_devices');
      return {select:()=>({eq:()=>({eq:()=>({
        maybeSingle:async()=>({data:{id:DEVICE,owner_id:OWNER,bridge_enabled:false},error:null})
      })})})};
    },
    async rpc(name,args){
      calls.push({name,args});
      return {data:ADMIN,error:null};
    }
  };
  const auth={getSession:async()=>({data:{session:{
    access_token:'a'.repeat(40),user:{id:OWNER}
  }}})};
  const client=createBridgeOwnerControls({db,auth});
  assert.equal(await client.activateFamily(DEVICE),true);
  assert.deepEqual(calls,[{
    name:'bridge_owner_activate_family',args:{p_device_id:DEVICE}
  }]);
  await assert.rejects(()=>client.activateFamily('invalid'),/invalid_control/);
  assert.equal(calls.length,1);
});
