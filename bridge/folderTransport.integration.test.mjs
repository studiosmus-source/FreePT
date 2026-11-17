import test from 'node:test';
import assert from 'node:assert/strict';
import {createBridgePostgresRequestHandlers} from './postgresRequestHandlers.mjs';
import {createBridgeLoopbackTestServer} from './loopbackHttp.mjs';

const DEVICE='11111111-1111-4111-8111-111111111111';
const ADMIN='22222222-2222-4222-8222-222222222222';
const JOB='33333333-3333-4333-8333-333333333333';
const HANDLE='44444444-4444-4444-8444-444444444444';
const SECRET='a'.repeat(64),VERIFIER='b'.repeat(64),BEARER='c'.repeat(40);
const entries=[{handle:HANDLE,name:'Foto',directory:true,size:-1,mime:'vnd.android.document/directory'}];
test('HTTP catalogue flow is bound to admin login and TX device session; no file bytes',async t=>{
  let binding=null,jobState=null,stored=null;
  const calls=[];
  const rpcClient={async rpc(name,args){
    calls.push(name);
    if(name==='bridge_server_open_tx_session'){binding=args.p_token_hash_hex;return {data:new Date(Date.now()+60000).toISOString(),error:null};}
    if(name==='bridge_server_assert_tx_session')
      return {data:args.p_token_hash_hex===binding?binding:null,error:null};
    if(name==='bridge_server_enqueue_list'){jobState='queued';return {data:args.p_job_id,error:null};}
    if(name==='bridge_server_claim_list'){jobState='sent';return {data:JOB,error:null};}
    if(name==='bridge_server_complete_folder_page'){
      assert.equal(args.p_session_binding_hex,binding);
      assert.deepEqual(args.p_entries,entries);
      if(jobState!=='sent')return {data:null,error:{code:'42501'}};
      stored=args.p_entries;jobState='done';return {data:true,error:null};
    }
    if(name==='bridge_server_read_folder_page')
      return jobState==='done'?{data:stored,error:null}:{data:null,error:{code:'42501'}};
    throw Error('unexpected_rpc:'+name);
  }};
  const handlers=createBridgePostgresRequestHandlers({
    rpcClient,
    authenticateAdmin:async ctx=>ctx?.accessToken===BEARER?{id:ADMIN,role:'admin',approved:true}:null,
    authenticateDevice:async ({deviceId,deviceSecret})=>
      deviceId===DEVICE&&deviceSecret===SECRET?{verifierHex:VERIFIER}:null,
    newJobId:()=>JOB
  });
  const server=createBridgeLoopbackTestServer({handler:handlers.admin,txHandler:handlers.tx});
  const url=await server.start();
  t.after(()=>server.stop());
  async function post(path,body,authorized=false){
    const result=await fetch(url+path,{method:'POST',
      headers:{'content-type':'application/json',...(authorized?{authorization:'Bearer '+BEARER}:{})},
      body:JSON.stringify(body)});
    return {status:result.status,body:await result.json()};
  }
  assert.equal((await post('/bridge/admin/folder',{jobId:JOB})).status,401);
  const queued=await post('/bridge/admin/list',{deviceId:DEVICE},true);
  assert.equal(queued.status,202);
  const device=await post('/bridge/tx/connect',{deviceId:DEVICE,deviceSecret:SECRET});
  assert.equal(device.status,200);
  const sessionToken=device.body.token;
  const polled=await post('/bridge/tx/poll',{deviceId:DEVICE,sessionToken});
  assert.equal(polled.body.job.jobId,JOB);
  assert.equal((await post('/bridge/tx/folder',{
    deviceId:DEVICE,sessionToken:'0'.repeat(64),jobId:JOB,entries
  })).status,403);
  assert.equal(stored,null);
  assert.equal((await post('/bridge/tx/folder',{
    deviceId:DEVICE,sessionToken,jobId:JOB,entries:[{...entries[0],name:'../private'}]
  })).status,400);
  assert.equal(stored,null);
  assert.equal((await post('/bridge/tx/folder',{
    deviceId:DEVICE,sessionToken,jobId:JOB,entries
  })).status,200);
  const received=await post('/bridge/admin/folder',{jobId:JOB},true);
  assert.equal(received.status,200);
  assert.deepEqual(received.body,{jobId:JOB,entries,nextOffset:-1});
  assert.equal(JSON.stringify(received.body).includes(sessionToken),false);
  assert.ok(calls.includes('bridge_server_complete_folder_page'));
  assert.ok(calls.includes('bridge_server_read_folder_page'));
  assert.equal((await post('/bridge/tx/folder',{
    deviceId:DEVICE,sessionToken,jobId:JOB,entries
  })).status,403);
});
