import test from 'node:test';
import assert from 'node:assert/strict';
import {createBridgeOwnerClient} from '../src/bridgeOwnerClient.js';
const DEVICE='11111111-1111-4111-8111-111111111111';
const TOKEN='a'.repeat(40),SECRET='b'.repeat(64);
function fixture({status=201,keystoreFails=false}={}){
  const requests=[];let saved=null,serverDevice=false;
  const credentials={
    async status(){return saved?{provisioned:true,deviceId:saved.deviceId}:{provisioned:false}},
    async provision(payload){
      if(keystoreFails)throw Error('native_fail');
      saved=payload;return {saved:true};
    },
    async clear(){saved=null;return {cleared:true}}
  };
  const fetchImpl=async (url,options)=>{
    const action=url.split('/').at(-1);
    requests.push({action,body:JSON.parse(options.body),auth:options.headers.authorization});
    if(action==='enroll'){
      if(status!==201)return {ok:false,status};
      serverDevice=true;
      return {ok:true,status:201,json:async()=>({deviceId:DEVICE,deviceSecret:SECRET})};
    }
    if(action==='delete'){
      assert.equal(serverDevice,true);
      assert.equal(JSON.parse(options.body).deviceId,DEVICE);
      serverDevice=false;
      return {ok:true,status:200,json:async()=>({deleted:true})};
    }
    throw Error('unexpected');
  };
  const client=createBridgeOwnerClient({
    baseUrl:'https://bridge-test.example.test',
    auth:{async getSession(){return {data:{session:{access_token:TOKEN}}}}},
    credentials,fetchImpl
  });
  return {client,requests,getSaved:()=>saved,isEnrolled:()=>serverDevice};
}
test('authenticated owner provisions the individual secret only into native Keystore',async()=>{
  const f=fixture();assert.equal((await f.client.status()).provisioned,false);
  assert.deepEqual(await f.client.enroll(' My Android '),{deviceId:DEVICE,provisioned:true});
  assert.equal(f.getSaved().deviceSecret,SECRET);
  assert.deepEqual(f.requests[0].body,{label:'My Android'});
  assert.equal(f.requests[0].auth,'Bearer '+TOKEN);
  assert.equal(JSON.stringify(f.requests).includes(SECRET),false);
  assert.deepEqual(await f.client.enroll('Again'),{
    deviceId:DEVICE,provisioned:true,alreadyProvisioned:true
  });
  assert.deepEqual(f.requests.map(x=>x.action),['enroll']);
  assert.equal(await f.client.remove(),true);
  assert.equal(f.getSaved(),null);
  assert.equal(f.isEnrolled(),false);
});
test('failed secure storage revokes server enrollment and never returns raw secret',async()=>{
  const f=fixture({keystoreFails:true});
  await assert.rejects(()=>f.client.enroll('Android'),/keystore_failed/);
  assert.equal(f.isEnrolled(),false);
  assert.deepEqual(f.requests.map(x=>x.action),['enroll','delete']);
});
test('bad owner inputs or untrusted endpoint fail before network',async()=>{
  const f=fixture();
  for(const label of ['','a\nb',null,'x'.repeat(101)])
    await assert.rejects(()=>f.client.enroll(label),/invalid_label/);
  assert.equal(f.requests.length,0);
  assert.equal(createBridgeOwnerClient({
    baseUrl:'https://cpopqsvzzxfjgnlawlvc.supabase.co',
    auth:{getSession(){}},credentials:{provision(){},status(){},clear(){}}
  }),null);
});
test('unapproved owner does not provision a device',async()=>{
  const f=fixture({status:403});
  await assert.rejects(()=>f.client.enroll('Android'),/owner_denied/);
  assert.equal(f.requests.length,1);
  assert.equal(f.getSaved(),null);
});

test('existing local TX enrollment is reused without re-enrolling or clearing credentials',async()=>{
  const f=fixture();
  await f.client.enroll('First phone');
  const before=f.getSaved();
  assert.equal((await f.client.enroll('Again')).alreadyProvisioned,true);
  assert.equal(f.getSaved(),before);
  assert.equal(f.requests.length,1);
});
