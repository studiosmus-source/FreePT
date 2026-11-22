import test from 'node:test';
import assert from 'node:assert/strict';
import {createBridgeAdminClient} from '../src/bridgeAdminClient.js';

const DEVICE='11111111-1111-4111-8111-111111111111';
const JOB='22222222-2222-4222-8222-222222222222';
function setup(t,{failWake=false}={}){
  let now=1_000_000,state='queued',authorized=true;
  t.mock.method(Date,'now',()=>now);
  const wakes=[];
  const api=createBridgeAdminClient({
    baseUrl:'https://bridge.example.test',
    auth:{async getSession(){
      return {data:{session:authorized?{access_token:'x'.repeat(40)}:null}};
    }},
    fetchImpl:async()=>({ok:true,json:async()=>({jobId:JOB,deviceId:DEVICE,state})}),
    wakeJob:async job=>{
      wakes.push(job);
      if(failWake)throw Error('temporary_failure');
    }
  });
  return {api,wakes,advance:ms=>{now+=ms;},setState:value=>{state=value;},
    logout:()=>{authorized=false;}};
}

test('a queued job retries a lost wake automatically, at most every 15 seconds',async t=>{
  const f=setup(t);
  await f.api.requestList(DEVICE);
  assert.equal(f.wakes.length,1);
  for(let i=0;i<14;i++){f.advance(1000);await f.api.getStatus(JOB);}
  assert.equal(f.wakes.length,1,'status polling must not create a push storm');
  f.advance(1000);await f.api.getStatus(JOB);
  assert.equal(f.wakes.length,2);
  assert.deepEqual(f.wakes[1],{jobId:JOB,deviceId:DEVICE});
  f.advance(15000);await f.api.getStatus(JOB);
  assert.equal(f.wakes.length,3);
});

test('wake transport failure does not discard the job or disable a later automatic retry',async t=>{
  const f=setup(t,{failWake:true});
  assert.equal((await f.api.requestList(DEVICE)).state,'queued');
  f.advance(15000);
  assert.equal((await f.api.getStatus(JOB)).state,'queued');
  assert.equal(f.wakes.length,2);
  await new Promise(resolve=>setImmediate(resolve));
});

test('claimed and terminal jobs never trigger a wake retry',async t=>{
  const f=setup(t);
  await f.api.requestList(DEVICE);
  for(const state of ['sent','done','cancelled','expired']){
    f.advance(20000);f.setState(state);
    await f.api.getStatus(JOB);
  }
  assert.equal(f.wakes.length,1);
});

test('logout blocks wake retries before any backend or push request',async t=>{
  const f=setup(t);
  await f.api.requestList(DEVICE);
  f.advance(20000);f.logout();
  await assert.rejects(()=>f.api.getStatus(JOB),/bridge_auth_required/);
  assert.equal(f.wakes.length,1);
});
