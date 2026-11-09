import test from 'node:test';
import assert from 'node:assert/strict';
import {createPushRegistration} from './pushRegistration.js';
test('push registers only approved user and cleans up their own token',async()=>{
  let user=null,listener={},writes=[],deletes=[];
  const plugin={
    addListener:async(name,fn)=>{listener[name]=fn},
    checkPermissions:async()=>({receive:'granted'}),
    register:async()=>{await listener.registration({value:'fake-token-for-test'})}
  };
  const db={from:()=>({
    upsert:async data=>{writes.push(data);return {error:null}},
    delete:()=>({eq:(k,v)=>({eq:async(k2,v2)=>{deletes.push([k,v,k2,v2]);return {error:null}}})})
  })};
  const push=createPushRegistration({plugin,db,getApprovedUser:()=>user,onMessage:()=>{}});
  await push.init();
  assert.equal(writes.length,0);
  user={id:'user-a'};
  await push.init();
  assert.equal(writes[0].user_id,'user-a');
  await push.clear('user-a');
  assert.deepEqual(deletes,[['token','fake-token-for-test','user_id','user-a']]);
});
test('registration callback refuses token after logout',async()=>{
  let user={id:'user-a'},onRegistration,writes=0;
  const push=createPushRegistration({
    plugin:{addListener:async(name,fn)=>{if(name==='registration')onRegistration=fn},
      checkPermissions:async()=>({receive:'granted'}),register:async()=>{}},
    db:{from:()=>({upsert:async()=>{writes++;return {error:null}}})},
    getApprovedUser:()=>user,onMessage:()=>{}
  });
  await push.init();
  user=null;
  await onRegistration({value:'token'});
  assert.equal(writes,0);
});
