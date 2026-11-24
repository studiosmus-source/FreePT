import test from 'node:test';
import assert from 'node:assert/strict';
import {backendFailure,retryableBackendFailure} from './backendFailure.mjs';
import {createBridgeTxRequestHandler} from './txRequestHandler.mjs';
import {BridgePostgresTxSessions} from './postgresTxSessions.mjs';
import {createPostgresDeviceAuthenticator} from './postgresDeviceAuth.mjs';
import {BridgePostgresJobsAdapter} from './postgresJobsAdapter.mjs';

const DEVICE='11111111-1111-4111-8111-111111111111';
const JOB='33333333-3333-4333-8333-333333333333';
const SECRET='a'.repeat(64);
const token='b'.repeat(64);
const VERIFIER='c'.repeat(64);
const req=()=>({method:'POST',path:'/bridge/tx/connect',body:{deviceId:DEVICE,deviceSecret:SECRET}});

test('only recognized transport failures are retryable; authorization remains final',()=>{
  for(const status of [502,503,504])assert.equal(retryableBackendFailure({code:'PGRST000'},status),true);
  for(const value of [{code:'42501'},{code:'PGRST301'},new Error('network down'),{code:'22023'}]){
    assert.equal(retryableBackendFailure(value,503),false);
    assert.equal(backendFailure('unavailable',value).retryable,undefined);
  }
  assert.equal(backendFailure('down',{name:'AbortError'}).retryable,true);
  assert.equal(backendFailure('down',{cause:{code:'ECONNRESET'}}).retryable,true);
  assert.equal(backendFailure('down',{code:'42501'},403).retryable,undefined);
});

test('transient session RPC 503 reaches Android as 503 without poisoning login attempts',async()=>{
  let fail=true;
  const session=new BridgePostgresTxSessions({
    rpcClient:{rpc:async()=>fail?{data:null,error:{code:'PGRST000'},status:503}:{data:new Date(Date.now()+300000).toISOString(),error:null}},
    authenticateDevice:async()=>({verifierHex:VERIFIER})
  });
  const tx=createBridgeTxRequestHandler({
    service:{connectDevice:p=>session.connect(p),pollDevice:async()=>null,completeDevice:async()=>null},
    maxFailures:1
  });
  assert.deepEqual(await tx(req()),{status:503,body:{error:'bridge_unavailable'}});
  fail=false;
  assert.equal((await tx(req())).status,200);
});

test('SQL authorization error cannot be classified as outage or retried',async()=>{
  const session=new BridgePostgresTxSessions({
    rpcClient:{rpc:async()=>({data:null,error:{code:'42501'},status:403})},
    authenticateDevice:async()=>({verifierHex:VERIFIER})
  });
  const tx=createBridgeTxRequestHandler({
    service:{connectDevice:p=>session.connect(p),pollDevice:async()=>null,completeDevice:async()=>null},
    maxFailures:1
  });
  assert.deepEqual(await tx(req()),{status:403,body:{error:'tx_denied'}});
  assert.equal((await tx(req())).status,429);
});

test('unavailable verifier transport retries, unknown verifier stays unauthorized',async()=>{
  let available=false;
  const verifierClient={from:()=>({select:()=>({eq:()=>({
    maybeSingle:async()=>available?{data:null,error:null}:{data:null,error:{code:'PGRST000'},status:503}
  })})})};
  const authenticate=createPostgresDeviceAuthenticator({verifiersClient:verifierClient});
  const tx=createBridgeTxRequestHandler({
    service:{
      connectDevice:async p=>{
        const v=await authenticate(p);
        if(!v)throw Error('device_not_authenticated');
        return {token};
      },pollDevice:async()=>null,completeDevice:async()=>null
    },maxFailures:1
  });
  assert.equal((await tx(req())).status,503);
  available=true;
  assert.equal((await tx(req())).status,403);
});

test('expired terminal job status is accepted; invalid state and cancel remain fenced',async()=>{
  let state='expired';
  const adapter=new BridgePostgresJobsAdapter({
    rpcClient:{rpc:async()=>({data:{jobId:JOB,deviceId:DEVICE,state},error:null})},
    sessions:{getDispatchBinding:async()=>token},
    authenticateAdmin:async()=>({id:'22222222-2222-4222-8222-222222222222',role:'admin',approved:true})
  });
  assert.equal((await adapter.getRequestStatus({authContext:'ok',jobId:JOB})).state,'expired');
  await assert.rejects(()=>adapter.cancelRequest({authContext:'ok',jobId:JOB}),/bridge_jobs_invalid_response/);
  state='garbage';
  await assert.rejects(()=>adapter.getRequestStatus({authContext:'ok',jobId:JOB}),/bridge_jobs_invalid_response/);
});
