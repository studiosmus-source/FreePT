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

test('late registration event is ignored during logout',async()=>{
  let user={id:'user-a'},callback,writes=0;
  const push=createPushRegistration({
    plugin:{addListener:async(name,fn)=>{if(name==='registration')callback=fn},
      checkPermissions:async()=>({receive:'granted'}),register:async()=>{}},
    db:{from:()=>({upsert:async()=>{writes++;return {error:null}}})},
    getApprovedUser:()=>user,onMessage:()=>{}
  });
  await push.init();
  await push.clear('user-a');
  await callback({value:'late-token'});
  assert.equal(writes,0);
});

test('denied notification permission never calls native register on later renders',async()=>{
  let checks=0,registers=0;
  const push=createPushRegistration({
    plugin:{addListener:async()=>{},checkPermissions:async()=>{checks++;return {receive:'denied'}},
      register:async()=>{registers++}},
    db:{from:()=>({})},getApprovedUser:()=>({id:'user-a'}),onMessage:()=>{}
  });
  await push.init();
  await push.init();
  assert.equal(checks,2);
  assert.equal(registers,0);
});

test('revoked Android permission prevents a later native registration',async()=>{
  let permission='granted',registers=0;
  const push=createPushRegistration({
    plugin:{addListener:async()=>{},checkPermissions:async()=>({receive:permission}),
      register:async()=>{registers++}},
    db:{from:()=>({})},getApprovedUser:()=>({id:'user-a'}),onMessage:()=>{}
  });
  await push.init();
  assert.equal(registers,1);
  permission='denied';
  await push.init();
  assert.equal(registers,1);
});

test('logout during delayed permission check cannot start native registration',async()=>{
  let release,registers=0;
  const gate=new Promise(resolve=>{release=resolve});
  const push=createPushRegistration({
    plugin:{addListener:async()=>{},checkPermissions:async()=>{await gate;return {receive:'granted'}},
      register:async()=>{registers++}},
    db:{from:()=>({})},getApprovedUser:()=>({id:'user-a'}),onMessage:()=>{}
  });
  const starting=push.init();
  await push.clear('user-a');
  release();
  await starting;
  assert.equal(registers,0);
});

test('logout during token upsert revokes completed registration even if profile remains loaded',async()=>{
  let callback,release,removed=[];
  const gate=new Promise(resolve=>{release=resolve});
  const push=createPushRegistration({
    plugin:{addListener:async(name,fn)=>{if(name==='registration')callback=fn},
      checkPermissions:async()=>({receive:'granted'}),register:async()=>{}},
    db:{from:()=>({
      upsert:async()=>{await gate;return {error:null}},
      delete:()=>({eq:(k,v)=>({eq:async(k2,v2)=>{removed.push([k,v,k2,v2]);return {error:null}}})})
    })},getApprovedUser:()=>({id:'user-a'}),onMessage:()=>{}
  });
  await push.init();
  const registration=callback({value:'token-a'});
  const logout=push.clear('user-a');
  release();
  await Promise.all([registration,logout]);
  assert.deepEqual(removed,[['token','token-a','user_id','user-a']]);
});

test('same approved account can register again after logout completes',async()=>{
  let user={id:'user-a'},callback,registers=0;
  const push=createPushRegistration({
    plugin:{addListener:async(name,fn)=>{if(name==='registration')callback=fn},
      checkPermissions:async()=>({receive:'granted'}),
      register:async()=>{registers++;await callback({value:'token-'+registers})}},
    db:{from:()=>({
      upsert:async()=>({error:null}),
      delete:()=>({eq:()=>({eq:async()=>({error:null})})})
    })},getApprovedUser:()=>user,onMessage:()=>{}
  });
  await push.init();
  await push.clear('user-a');
  await push.init();
  assert.equal(registers,1,'logout guard must remain active');
  user=null;
  await push.sessionEnded();
  user={id:'user-a'};
  await push.init();
  assert.equal(registers,2,'fresh login must register again');
});

test('logout while permission is pending allows safe same-account re-login',async()=>{
  let user={id:'user-a'},release,registers=0;
  const gate=new Promise(resolve=>{release=resolve});
  const push=createPushRegistration({
    plugin:{addListener:async()=>{},
      checkPermissions:async()=>{if(registers===0)await gate;return {receive:'granted'}},
      register:async()=>{registers++}},
    db:{from:()=>({})},getApprovedUser:()=>user,onMessage:()=>{}
  });
  const starting=push.init();
  await push.clear('user-a');
  user=null;
  const ending=push.sessionEnded();
  release();
  await Promise.all([starting,ending]);
  assert.equal(registers,0,'pending registration must not survive logout');
  user={id:'user-a'};
  await push.init();
  assert.equal(registers,1,'fresh login should register');
});
