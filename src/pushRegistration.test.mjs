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

test('logout waits for an in-flight token registration and removes it',async()=>{
  let user={id:'user-a'},onRegistration,resolveWrite,removed=[];
  const writeGate=new Promise(resolve=>{resolveWrite=resolve});
  const push=createPushRegistration({
    plugin:{addListener:async(name,fn)=>{if(name==='registration')onRegistration=fn},
      checkPermissions:async()=>({receive:'granted'}),register:async()=>{}},
    db:{from:()=>({
      upsert:async()=>{await writeGate;return {error:null}},
      delete:()=>({eq:(k,v)=>({eq:async(k2,v2)=>{removed.push([k,v,k2,v2]);return {error:null}}})})
    })},getApprovedUser:()=>user,onMessage:()=>{}
  });
  await push.init();
  const registration=onRegistration({value:'token-a'});
  const logout=push.clear('user-a');
  resolveWrite();
  await Promise.all([registration,logout]);
  assert.deepEqual(removed,[['token','token-a','user_id','user-a']]);
});
