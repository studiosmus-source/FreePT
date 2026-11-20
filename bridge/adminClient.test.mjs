import test from 'node:test';
import assert from 'node:assert/strict';
import {createBridgeAdminClient,normalizeBridgeApiUrl} from '../src/bridgeAdminClient.js';
const DEVICE='11111111-1111-4111-8111-111111111111';
const JOB='22222222-2222-4222-8222-222222222222';
const endpoint='https://bridge-staging.example.test';
const token='x'.repeat(40);
function client({authenticated=true,reply={jobId:JOB,deviceId:DEVICE,state:'queued'},status=202}={}) {
 const requests=[];
 const auth={async getSession(){return {data:{session:authenticated?{access_token:token}:null},error:null}}};
 const fetchImpl=async (...args)=>{requests.push(args);return {ok:status<400,status,json:async()=>reply}};
 return {requests,client:createBridgeAdminClient({baseUrl:endpoint,auth,fetchImpl})};
}
test('Bridge client stays disabled on missing, insecure, credentialed or production URLs',()=>{
 for(const url of ['',undefined,'http://bridge-staging.example.test',
   'https://cpopqsvzzxfjgnlawlvc.supabase.co','https://a:b@host.test',
   'https://bridge-staging.example.test/x','https://bridge-staging.example.test?x=1'
 ]) {
   assert.equal(normalizeBridgeApiUrl(url),null);
   assert.equal(createBridgeAdminClient({baseUrl:url,auth:{getSession(){}}}),null);
 }
});
test('Bridge requestList sends current bearer only to fixed HTTPS route',async()=>{
 const f=client();
 assert.deepEqual(await f.client.requestList(DEVICE),{jobId:JOB,deviceId:DEVICE,state:'queued'});
 const [url,request]=f.requests[0];
 assert.equal(url,endpoint+'/bridge/admin/list');
 assert.equal(request.headers.authorization,'Bearer '+token);
 assert.deepEqual(JSON.parse(request.body),{deviceId:DEVICE});
 assert.equal(request.redirect,'error');
});
test('Bridge client checks latest auth on every call; logout fails closed',async()=>{
 let loggedIn=true;
 let calls=0;
 const auth={async getSession(){return {data:{session:loggedIn?{access_token:token}:null}}}};
 const f=createBridgeAdminClient({baseUrl:endpoint,auth,fetchImpl:async()=>{
   calls++;return {ok:true,json:async()=>({jobId:JOB,deviceId:DEVICE,state:'queued'})};
 }});
 await f.getStatus(JOB);
 loggedIn=false;
 await assert.rejects(()=>f.getStatus(JOB),/bridge_auth_required/);
 assert.equal(calls,1);
});
test('Bridge client rejects malformed identifiers before sending any traffic',async()=>{
 const f=client();
 await assert.rejects(()=>f.client.requestList('../etc/passwd'),/bridge_invalid_id/);
 assert.equal(f.requests.length,0);
});
test('Bridge client never trusts unexpected backend result or unauthorised state',async()=>{
 for(const reply of [null,{}, {jobId:'bad',deviceId:DEVICE,state:'done'},
   {jobId:JOB,deviceId:JOB,state:'done'}, {jobId:JOB,deviceId:DEVICE,state:'infinite'}]) {
   const f=client({reply});
   await assert.rejects(()=>f.client.requestList(DEVICE),/bridge_invalid_response/);
 }
 const wrong=client({status:403});
 await assert.rejects(()=>wrong.client.requestList(DEVICE),/bridge_auth_required/);
});
test('Bridge client issues status and cancel with jobId only',async()=>{
 const f=client({reply:{jobId:JOB,deviceId:DEVICE,state:'cancelled'},status:200});
 assert.equal((await f.client.getStatus(JOB)).state,'cancelled');
 assert.equal((await f.client.cancel(JOB)).state,'cancelled');
 assert.equal(f.requests[0][0],endpoint+'/bridge/admin/status');
 assert.equal(f.requests[1][0],endpoint+'/bridge/admin/cancel');
 for(const request of f.requests)
   assert.deepEqual(JSON.parse(request[1].body),{jobId:JOB});
});

test('browsing passes an abort signal to HTTPS and stops promptly on navigation',async()=>{
 const controller=new AbortController();
 const endpoints=[],signals=[];
 const auth={async getSession(){return {data:{session:{access_token:token}},error:null}}};
 const api=createBridgeAdminClient({baseUrl:endpoint,auth,
  fetchImpl:async(url,options)=>{
   endpoints.push(url);signals.push(options.signal);
   return new Promise((resolve,reject)=>{
    options.signal?.addEventListener('abort',()=>reject(Error('aborted')),{once:true});
   });
  }
 });
 const pending=api.requestBrowse(DEVICE,{handle:'root',offset:0},{signal:controller.signal});
 // Allow getSession and fetchImpl to start before aborting.
 await Promise.resolve();await Promise.resolve();
 controller.abort();
 await assert.rejects(pending,/bridge_transfer_cancelled/);
 assert.deepEqual(endpoints,[endpoint+'/bridge/admin/browse']);
 assert.equal(signals[0],controller.signal);
});
test('aborted browse never sends a request after session lookup completes',async()=>{
 const controller=new AbortController(),endpoints=[];
 const auth={async getSession(){controller.abort();return {data:{session:{access_token:token}}}}};
 const api=createBridgeAdminClient({baseUrl:endpoint,auth,
  fetchImpl:async(url)=>{endpoints.push(url);throw Error('unexpected network call')}
 });
 await assert.rejects(api.requestBrowse(DEVICE,{handle:'root'},{
  signal:controller.signal
 }),/bridge_transfer_cancelled/);
 assert.equal(endpoints.length,0);
});

test('expired job status is accepted but never mistaken for a successful cancellation',async()=>{
 const f=client({reply:{jobId:JOB,deviceId:DEVICE,state:'expired'},status:200});
 assert.equal((await f.client.getStatus(JOB)).state,'expired');
 await assert.rejects(()=>f.client.cancel(JOB),/bridge_invalid_response/);
});
