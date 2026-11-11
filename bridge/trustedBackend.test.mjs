import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createTrustedBridgeBackend} from './trustedBackend.mjs';

const DEVICE='11111111-1111-4111-8111-111111111111';
const ADMIN='22222222-2222-4222-8222-222222222222';
const JOB='33333333-3333-4333-8333-333333333333';
const TOKEN='c'.repeat(40),SECRET='a'.repeat(64),SALT='b'.repeat(32);
const VERIFIER=createHash('sha256').update('freept-bridge-device-v1\0')
  .update(DEVICE).update('\0').update(SALT).update(SECRET).digest('hex');
const HEADER={authorization:'Bearer '+TOKEN};

function fixture({role='admin',status='approved',allowSecret=true}={}) {
  const calls=[];
  const authClient={auth:{async getUser(token){
    calls.push('auth.getUser');
    return {data:{user:token===TOKEN?{id:ADMIN,is_anonymous:false}:null},error:null};
  }}};
  const profilesClient={from(table){
    assert.equal(table,'profiles');
    return {select(){return {eq(){return {async maybeSingle(){
      calls.push('profiles.read');
      return {data:{id:ADMIN,role,status},error:null};
    }}}}}};
  }};
  const verifiersClient={from(table){
    assert.equal(table,'bridge_device_verifiers');
    return {select(){return {eq(){return {async maybeSingle(){
      calls.push('verifiers.read');
      return {data:{device_id:DEVICE,salt_hex:SALT,verifier_hex:VERIFIER},error:null};
    }}}}}};
  }};
  const rpcClient={async rpc(name,args){
    calls.push(name);
    if(name==='bridge_server_enqueue_list')return {data:args.p_job_id,error:null};
    if(name==='bridge_server_open_tx_session')
      return {data:new Date(Date.now()+60000).toISOString(),error:null};
    throw Error('unexpected rpc');
  }};
  const handlers=createTrustedBridgeBackend({
    authClient,profilesClient,verifiersClient,rpcClient,newJobId:()=>JOB
  });
  return {handlers,calls};
}

test('approved Supabase admin can queue a job only after live role lookup',async()=>{
  const {handlers,calls}=fixture();
  const result=await handlers.admin({
    method:'POST',path:'/bridge/admin/list',headers:HEADER,body:{deviceId:DEVICE}
  });
  assert.equal(result.status,202);
  assert.deepEqual(calls,[
    'auth.getUser','profiles.read','bridge_server_enqueue_list'
  ]);
});

test('ordinary or blocked user never reaches privileged RPC',async()=>{
  for(const options of [{role:'user'},{status:'blocked'}]){
    const {handlers,calls}=fixture(options);
    const response=await handlers.admin({
      method:'POST',path:'/bridge/admin/list',headers:HEADER,body:{deviceId:DEVICE}
    });
    assert.equal(response.status,403);
    assert.equal(calls.includes('bridge_server_enqueue_list'),false);
  }
});

test('TX secret verification uses persisted verifier before opening session',async()=>{
  const {handlers,calls}=fixture();
  const accepted=await handlers.tx({
    method:'POST',path:'/bridge/tx/connect',
    body:{deviceId:DEVICE,deviceSecret:SECRET}
  });
  assert.equal(accepted.status,200);
  assert.match(accepted.body.token,/^[0-9a-f]{64}$/);
  assert.deepEqual(calls,['verifiers.read','bridge_server_open_tx_session']);
  const refused=await handlers.tx({
    method:'POST',path:'/bridge/tx/connect',
    body:{deviceId:DEVICE,deviceSecret:'f'.repeat(64)}
  });
  assert.equal(refused.status,403);
  assert.equal(calls.filter(x=>x==='bridge_server_open_tx_session').length,1);
});

test('trusted backend rejects missing server-owned client dependencies',()=>{
  assert.throws(()=>createTrustedBridgeBackend(),/invalid_admin_auth_dependencies/);
  assert.throws(()=>createTrustedBridgeBackend({
    authClient:{auth:{getUser(){}}},profilesClient:{from(){}},
    verifiersClient:{from(){}},rpcClient:{}
  }),/invalid_bridge_postgres_service_dependencies/);
});
