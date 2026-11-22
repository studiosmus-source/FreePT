import test from 'node:test';
import assert from 'node:assert/strict';
import {createPcAccountLink,normalizePcLinkCode} from '../src/pcAccountLink.js';

const CODE='A1B2C3D4E5F60718293A4B5C';
const DEVICE='22222222-2222-4222-8222-222222222222';

test('pairing code accepts case and harmless separators only',()=>{
  assert.equal(normalizePcLinkCode('a1b2 c3d4-e5f6 0718-293a 4b5c'),CODE);
  for(const value of ['', '123', 'a1b2c3d4e5f60718293a4b5g', 'a'.repeat(25)])
    assert.throws(()=>normalizePcLinkCode(value),/pc_link_code_invalid/);
});

test('desktop creates an anonymous session before requesting a pairing code',async()=>{
  const calls=[];
  let signIns=0;
  const link=createPcAccountLink({
    auth:{
      async getSession(){return {data:{session:null},error:null};},
      async signInAnonymously(){signIns++;return {data:{user:{id:DEVICE,is_anonymous:true}},error:null};}
    },
    db:{async rpc(name,args){calls.push({name,args});return {data:CODE,error:null};}}
  });
  assert.equal(await link.start('PC Windows'),CODE);
  assert.equal(signIns,1);
  assert.deepEqual(calls,[{name:'freept_pc_link_start',args:{p_device_label:'PC Windows'}}]);
});

test('pairing refuses an existing non-anonymous session and bad server replies',async()=>{
  const link=createPcAccountLink({
    auth:{
      async getSession(){return {data:{session:{user:{id:DEVICE,is_anonymous:false}}},error:null};},
      async signInAnonymously(){throw Error('must_not_sign_in');}
    },
    db:{async rpc(){throw Error('must_not_call_rpc');}}
  });
  await assert.rejects(()=>link.start(),/pc_link_anonymous_session_required/);
});

test('Android approval validates input and returns only a successful one-time approval',async()=>{
  const calls=[];
  const link=createPcAccountLink({
    auth:{async getSession(){return {data:{session:null},error:null};},
      async signInAnonymously(){throw Error('not_used');}},
    db:{async rpc(name,args){calls.push({name,args});return {data:name==='freept_pc_link_approve',error:null};}}
  });
  assert.equal(await link.approve('a1b2-c3d4-e5f6-0718-293a-4b5c'),true);
  assert.deepEqual(calls,[{name:'freept_pc_link_approve',args:{p_code:CODE}}]);
  await assert.rejects(()=>link.approve('not a code'),/pc_link_code_invalid/);
  assert.equal(calls.length,1);
});

test('device list and revocation use only validated identifiers',async()=>{
  const calls=[];
  const link=createPcAccountLink({
    auth:{async getSession(){return {data:{session:null},error:null};},
      async signInAnonymously(){throw Error('not_used');}},
    db:{async rpc(name,args){calls.push({name,args});return {data:name==='freept_pc_link_list'?[{auth_user_id:DEVICE}]:true,error:null};}}
  });
  assert.deepEqual(await link.list(),[{auth_user_id:DEVICE}]);
  assert.equal(await link.revoke(DEVICE),true);
  await assert.rejects(()=>link.revoke('not-a-uuid'),/pc_link_device_invalid/);
  assert.deepEqual(calls,[
    {name:'freept_pc_link_list',args:undefined},
    {name:'freept_pc_link_revoke',args:{p_auth_user_id:DEVICE}}
  ]);
});
