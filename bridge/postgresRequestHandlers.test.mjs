import test from 'node:test';
import assert from 'node:assert/strict';
import {createBridgePostgresRequestHandlers} from './postgresRequestHandlers.mjs';
import {createBridgeLoopbackTestServer} from './loopbackHttp.mjs';

const DEVICE='11111111-1111-4111-8111-111111111111';
const ADMIN='22222222-2222-4222-8222-222222222222';
const JOB='33333333-3333-4333-8333-333333333333';
const SECRET='a'.repeat(64),VERIFIER='b'.repeat(64),TOKEN='c'.repeat(40);
function fixture() {
  let state=null,sessionHash=null;
  const calls=[];
  const rpcClient={async rpc(name,args) {
    calls.push(name);
    if(name==='bridge_server_enqueue_list'){state='queued';return {data:JOB,error:null};}
    if(name==='bridge_server_open_tx_session'){
      sessionHash=args.p_token_hash_hex;
      return {data:new Date(Date.now()+60000).toISOString(),error:null};
    }
    if(name==='bridge_server_assert_tx_session')
      return {data:args.p_token_hash_hex===sessionHash?sessionHash:null,error:null};
    if(name==='bridge_server_close_tx_session'){
      const matched=args.p_token_hash_hex===sessionHash;
      if(matched)sessionHash=null;
      return {data:matched,error:null};
    }
    if(name==='bridge_server_claim_list'){state='sent';return {data:JOB,error:null};}
    if(name==='bridge_server_complete_list'){state='done';return {data:true,error:null};}
    if(name==='bridge_server_job_status')
      return {data:{jobId:JOB,deviceId:DEVICE,state},error:null};
    if(name==='bridge_server_cancel_job'){
      state='cancelled';return {data:{jobId:JOB,deviceId:DEVICE,state},error:null};
    }
    throw Error('unexpected_rpc');
  }};
  const handlers=createBridgePostgresRequestHandlers({
    rpcClient,
    authenticateAdmin:async ctx=>ctx?.accessToken===TOKEN
      ?{id:ADMIN,role:'admin',approved:true}:null,
    authenticateDevice:async ({deviceId,deviceSecret})=>
      deviceId===DEVICE&&deviceSecret===SECRET?{verifierHex:VERIFIER}:null,
    newJobId:()=>JOB
  });
  return {handlers,calls};
}
async function post(url,path,payload,auth) {
  const headers={'content-type':'application/json'};
  if(auth)headers.authorization='Bearer '+auth;
  const response=await fetch(url+path,{
    method:'POST',headers,body:JSON.stringify(payload)
  });
  return {status:response.status,body:await response.json()};
}
test('one trusted service backs admin and TX routes on local-only HTTP test adapter',async t=>{
  const f=fixture();
  const server=createBridgeLoopbackTestServer({
    handler:f.handlers.admin,txHandler:f.handlers.tx
  });
  const url=await server.start();
  t.after(()=>server.stop());
  const admin=await post(url,'/bridge/admin/list',{deviceId:DEVICE},TOKEN);
  assert.equal(admin.status,202);
  const connected=await post(url,'/bridge/tx/connect',{deviceId:DEVICE,deviceSecret:SECRET});
  assert.equal(connected.status,200);
  const polled=await post(url,'/bridge/tx/poll',{
    deviceId:DEVICE,sessionToken:connected.body.token
  });
  assert.equal(polled.body.job.jobId,JOB);
  const completed=await post(url,'/bridge/tx/complete',{
    deviceId:DEVICE,sessionToken:connected.body.token,jobId:JOB
  });
  assert.equal(completed.body.state,'done');
  const status=await post(url,'/bridge/admin/status',{jobId:JOB},TOKEN);
  assert.equal(status.body.state,'done');
  assert.ok(f.calls.includes('bridge_server_assert_tx_session'));
});
test('publicly exposed handlers do not accept unauthenticated admin or unknown TX',async()=>{
  const f=fixture();
  assert.deepEqual(Object.keys(f.handlers).sort(),['admin','tx']);
  assert.equal(Object.isFrozen(f.handlers),true);
  const admin=await f.handlers.admin({
    method:'POST',path:'/bridge/admin/list',headers:{},
    body:{deviceId:DEVICE}
  });
  assert.equal(admin.status,401);
  const tx=await f.handlers.tx({
    method:'POST',path:'/bridge/tx/connect',
    body:{deviceId:DEVICE,deviceSecret:'f'.repeat(64)}
  });
  assert.equal(tx.status,403);
  assert.equal(f.calls.length,0);
});
test('server-only request wiring rejects absent trusted adapters',()=>{
  assert.throws(()=>createBridgePostgresRequestHandlers(),/invalid_bridge_postgres_service_dependencies/);
  assert.throws(()=>createBridgePostgresRequestHandlers({
    rpcClient:{rpc(){}},authenticateAdmin:()=>null,authenticateDevice:()=>null,
    newJobId:null
  }),/invalid_bridge_request_dependencies/);
});

test('TX disconnect revokes the active session and blocks later polling over local HTTP',async t=>{
  const f=fixture();
  const server=createBridgeLoopbackTestServer({
    handler:f.handlers.admin,txHandler:f.handlers.tx
  });
  const url=await server.start();
  t.after(()=>server.stop());
  const login=await post(url,'/bridge/tx/connect',{
    deviceId:DEVICE,deviceSecret:SECRET
  });
  assert.equal(login.status,200);
  const token=login.body.token;
  const disconnect=await post(url,'/bridge/tx/disconnect',{
    deviceId:DEVICE,sessionToken:token
  });
  assert.equal(disconnect.status,200);
  assert.deepEqual(disconnect.body,{closed:true});
  assert.ok(f.calls.includes('bridge_server_close_tx_session'));
  const stale=await post(url,'/bridge/tx/poll',{
    deviceId:DEVICE,sessionToken:token
  });
  assert.equal(stale.status,403);
  const repeated=await post(url,'/bridge/tx/disconnect',{
    deviceId:DEVICE,sessionToken:token
  });
  assert.equal(repeated.status,403);
  assert.equal(JSON.stringify(disconnect.body).includes(token),false);
});

test('TX disconnect refuses wrong authenticated session',async()=>{
  const f=fixture();
  const wrong=await f.handlers.tx({
    method:'POST',path:'/bridge/tx/disconnect',
    body:{deviceId:DEVICE,sessionToken:'a'.repeat(64)}
  });
  assert.equal(wrong.status,403);
});
