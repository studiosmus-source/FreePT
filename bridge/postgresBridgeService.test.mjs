import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createBridgePostgresService} from './postgresBridgeService.mjs';
import {createBridgeAdminRequestHandler} from './adminRequestHandler.mjs';
import {createBridgeTxRequestHandler} from './txRequestHandler.mjs';

const DEVICE='11111111-1111-4111-8111-111111111111';
const ADMIN='22222222-2222-4222-8222-222222222222';
const JOB='33333333-3333-4333-8333-333333333333';
const SECRET='a'.repeat(64);
const VERIFIER='b'.repeat(64);
const AUTH={authorization:'Bearer '+'c'.repeat(40)};

function makeFixture() {
  const requests=[];
  let currentBinding=null;
  let state=null;
  const rpcClient={async rpc(name,args) {
    requests.push({name,args});
    if(name==='bridge_server_open_tx_session'){
      currentBinding=args.p_token_hash_hex;
      return {data:new Date(Date.now()+60_000).toISOString(),error:null};
    }
    if(name==='bridge_server_assert_tx_session')
      return {data:args.p_token_hash_hex===currentBinding?currentBinding:null,error:null};
    if(name==='bridge_server_enqueue_list'){
      state='queued';
      return {data:args.p_job_id,error:null};
    }
    if(name==='bridge_server_claim_list'){
      if(args.p_session_binding_hex!==currentBinding)
        return {data:null,error:{code:'42501'}};
      state='sent';
      return {data:JOB,error:null};
    }
    if(name==='bridge_server_complete_list'){
      if(args.p_session_binding_hex!==currentBinding)
        return {data:false,error:null};
      state='done';
      return {data:true,error:null};
    }
    if(name==='bridge_server_job_status')
      return {data:{jobId:JOB,deviceId:DEVICE,state},error:null};
    if(name==='bridge_server_cancel_job'){
      state='cancelled';
      return {data:{jobId:JOB,deviceId:DEVICE,state},error:null};
    }
    if(name==='bridge_server_close_tx_session'){
      const match=args.p_token_hash_hex===currentBinding;
      if(match)currentBinding=null;
      return {data:match,error:null};
    }
    throw Error('unexpected_rpc:'+name);
  }};
  const service=createBridgePostgresService({
    rpcClient,
    authenticateAdmin:async ctx=>ctx?.accessToken==='c'.repeat(40)
      ? {id:ADMIN,role:'admin',approved:true}:null,
    authenticateDevice:async ({deviceId,deviceSecret})=>
      deviceId===DEVICE&&deviceSecret===SECRET?{verifierHex:VERIFIER}:null
  });
  return {service,requests};
}

test('server-only composition completes admin enqueue and authenticated TX job',async()=>{
  const f=makeFixture();
  const admin=createBridgeAdminRequestHandler({service:f.service,newJobId:()=>JOB});
  const tx=createBridgeTxRequestHandler({service:f.service});
  const queued=await admin({method:'POST',path:'/bridge/admin/list',headers:AUTH,
    body:{deviceId:DEVICE}});
  assert.equal(queued.status,202);
  const connected=await tx({method:'POST',path:'/bridge/tx/connect',
    body:{deviceId:DEVICE,deviceSecret:SECRET}});
  assert.equal(connected.status,200);
  assert.match(connected.body.token,/^[0-9a-f]{64}$/);
  const claimed=await tx({method:'POST',path:'/bridge/tx/poll',
    body:{deviceId:DEVICE,sessionToken:connected.body.token}});
  assert.equal(claimed.status,200);
  assert.equal(claimed.body.job.jobId,JOB);
  const completed=await tx({method:'POST',path:'/bridge/tx/complete',
    body:{deviceId:DEVICE,sessionToken:connected.body.token,jobId:JOB}});
  assert.equal(completed.status,200);
  assert.equal(completed.body.state,'done');
  const status=await admin({method:'POST',path:'/bridge/admin/status',headers:AUTH,
    body:{jobId:JOB}});
  assert.equal(status.status,200);
  assert.equal(status.body.state,'done');
  assert.ok(f.requests.some(x=>x.name==='bridge_server_assert_tx_session'));
  const opened=f.requests.find(x=>x.name==='bridge_server_open_tx_session');
  const digest=createHash('sha256').update('freept-bridge-session-v1\0')
    .update(connected.body.token).digest('hex');
  assert.equal(opened.args.p_token_hash_hex,digest);
  assert.equal(JSON.stringify(f.requests).includes(connected.body.token),false);
  assert.equal(JSON.stringify(f.requests).includes(SECRET),false);
});

test('server-only composition rejects unauthenticated admin and unknown TX',async()=>{
  const f=makeFixture();
  const admin=createBridgeAdminRequestHandler({service:f.service,newJobId:()=>JOB});
  const tx=createBridgeTxRequestHandler({service:f.service});
  const denied=await admin({method:'POST',path:'/bridge/admin/list',
    headers:{authorization:'Bearer '+'d'.repeat(40)},body:{deviceId:DEVICE}});
  assert.equal(denied.status,403);
  const wrong=await tx({method:'POST',path:'/bridge/tx/connect',
    body:{deviceId:DEVICE,deviceSecret:'f'.repeat(64)}});
  assert.equal(wrong.status,403);
  assert.equal(f.requests.length,0);
});

test('composition exposes only fixed job and session operations',()=>{
  const {service}=makeFixture();
  assert.deepEqual(Object.keys(service).sort(),[
    'cancelRequest','closeDeviceSession','completeDevice','connectDevice',
    'getRequestStatus','pollDevice','requestList'
  ].sort());
  assert.equal(Object.isFrozen(service),true);
  assert.equal('readFile' in service,false);
  assert.equal('uploadFile' in service,false);
  assert.throws(()=>createBridgePostgresService({}),/invalid_bridge_postgres_service_dependencies/);
});
