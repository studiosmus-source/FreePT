import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {createBridgeHttpsGateway} from './httpsGateway.mjs';
import {createBridgeStagingHttpsService} from './httpsStagingServer.mjs';
import {createBridgeRequestDiagnostics,stagingBridgeDiagnostics} from './requestDiagnostics.mjs';

const DEVICE='11111111-1111-4111-8111-111111111111';
const JOB='22222222-2222-4222-8222-222222222222';
const SECRET='PRIVATE_DEVICE_SECRET_DO_NOT_LOG';
const FILE='/storage/emulated/0/.private/family-photo.jpg';
function capture(options={}){
  const records=[];
  const diagnostics=createBridgeRequestDiagnostics({
    ...options,sink:line=>records.push(JSON.parse(line))
  });
  return {records,diagnostics};
}
test('staging diagnostics require an exact opt-in; bad configuration is explicit',()=>{
  assert.equal(stagingBridgeDiagnostics({}),null);
  assert.equal(stagingBridgeDiagnostics({FREEPT_BRIDGE_DIAGNOSTICS:''}),null);
  assert.throws(()=>stagingBridgeDiagnostics({
    FREEPT_BRIDGE_DIAGNOSTICS:'true'
  }),/opt_in_invalid/);
  assert.equal(typeof stagingBridgeDiagnostics({
    FREEPT_BRIDGE_DIAGNOSTICS:'STAGING_METADATA_V1'
  }).begin,'function');
  assert.throws(()=>createBridgeRequestDiagnostics({waitingMs:0}),/dependencies_invalid/);
});
test('references correlate jobs and devices without logging identities or payloads',()=>{
  const {records,diagnostics}=capture();
  const first=diagnostics.begin('/bridge/admin/browse');
  first.dispatch({deviceId:DEVICE,authorization:SECRET,handle:FILE});
  first.result(202,{deviceId:DEVICE,jobId:JOB,state:'queued',entries:[{name:FILE}]});
  first.finish(202);
  first.abort(); // Normal close after finish is not an aborted request.
  const second=diagnostics.begin('/bridge/tx/poll');
  second.dispatch({deviceId:DEVICE,sessionToken:SECRET});
  second.result(200,{job:{jobId:JOB,path:FILE,deviceSecret:SECRET}});
  second.finish(200);
  const queued=records.find(x=>x.state==='queued');
  const claimed=records.find(x=>x.operation==='tx/poll'&&x.phase==='result');
  assert.equal(queued.job,claimed.job);
  assert.equal(queued.device,claimed.device);
  assert.notEqual(queued.request,claimed.request);
  assert.equal(queued.instance,claimed.instance);
  assert.equal(claimed.hasJob,true);
  assert.match(queued.job,/^[a-f0-9]{24}$/);
  assert.deepEqual(records.slice(0,4).map(x=>x.phase),
    ['received','dispatched','result','finished']);
  for(const value of [DEVICE,JOB,SECRET,FILE,'family-photo','sessionToken','authorization'])
    assert.equal(JSON.stringify(records).includes(value),false,value);
  const other=capture();
  const trace=other.diagnostics.begin('/bridge/tx/poll');
  trace.dispatch({deviceId:DEVICE});trace.result(200,{job:{jobId:JOB}});trace.finish(200);
  assert.notEqual(other.records.find(x=>x.phase==='result').job,claimed.job);
});
test('untrusted routes, states, identifiers and arbitrary errors cannot inject logs',()=>{
  const {records,diagnostics}=capture();
  for(const path of ['/health','/bridge/admin/status?secret='+SECRET,'/bridge/'+FILE])
    assert.equal(diagnostics.begin(path),null);
  assert.equal(records.length,0);
  const trace=diagnostics.begin('/bridge/tx/poll');
  trace.dispatch({deviceId:FILE,jobId:SECRET});
  trace.result(403,{deviceId:FILE,jobId:SECRET,state:FILE,error:SECRET,job:null});
  trace.finish(403);
  const result=records.find(x=>x.phase==='result');
  assert.equal(result.error,'unclassified_error');
  assert.equal(result.job,undefined);
  assert.equal(result.device,undefined);
  assert.equal(result.state,undefined);
  assert.equal(result.hasJob,undefined); // A denial is not an empty successful poll.
  assert.equal(JSON.stringify(records).includes(SECRET),false);
  assert.equal(JSON.stringify(records).includes(FILE),false);
});
test('slow-handler marker and disconnect marker do not alter or duplicate completion',async()=>{
  const {records,diagnostics}=capture({waitingMs:5});
  const trace=diagnostics.begin('/bridge/admin/status');
  trace.dispatch({jobId:JOB});
  await delay(15);
  assert.equal(records.filter(x=>x.phase==='handler_waiting').length,1);
  trace.abort();trace.abort();trace.finish(200);trace.result(200,{state:'done'});
  await delay(10);
  assert.equal(records.filter(x=>x.phase==='aborted').length,1);
  assert.equal(records.some(x=>x.phase==='finished'),false);
});
test('quick results cancel slow-handler timers and successful empty polls are distinct',async()=>{
  const {records,diagnostics}=capture({waitingMs:5});
  const trace=diagnostics.begin('/bridge/tx/poll');
  trace.dispatch({deviceId:DEVICE});
  trace.result(200,{job:null});trace.finish(200);
  await delay(15);
  assert.equal(records.some(x=>x.phase==='handler_waiting'),false);
  assert.equal(records.find(x=>x.phase==='result').hasJob,false);
});
test('diagnostic volume is bounded without blocking operations and suppression is visible',()=>{
  let time=0;
  const {records,diagnostics}=capture({now:()=>time,maxEventsPerMinute:2});
  const trace=diagnostics.begin('/bridge/admin/status');
  trace.dispatch({jobId:JOB});trace.result(200,{state:'queued'});trace.finish(200);
  assert.equal(records.length,2);
  time=60000;
  diagnostics.begin('/bridge/admin/status').finish(200);
  assert.equal(records[2].phase,'suppressed');
  assert.equal(records[2].count,2);
  assert.equal(records.at(-1).phase,'finished');
});
async function serve(t,handler,diagnostics){
  const gateway=createBridgeHttpsGateway({
    admin:handler,owner:handler,tx:handler,
    config:{origins:['https://localhost']},allowHttpInUnitTests:true,diagnostics
  });
  const address=await gateway.start();
  t.after(()=>gateway.stop());
  return async(path,body={},headers={})=>{
    const response=await fetch('http://127.0.0.1:'+address.port+path,{
      method:'POST',headers:{
        'content-type':'application/json',origin:'https://localhost',
        authorization:'Bearer '+SECRET,...headers
      },body:JSON.stringify(body)
    });
    return {status:response.status,body:await response.json()};
  };
}
test('real HTTP flow traces queue, phone claim, result and admin delivery with unchanged bodies',async t=>{
  const {records,diagnostics}=capture();
  let done=false;
  const handler=async req=>{
    switch(req.path){
      case '/bridge/admin/browse':
        return {status:202,body:{deviceId:DEVICE,jobId:JOB,state:'queued'}};
      case '/bridge/tx/poll':
        return {status:200,body:{job:{jobId:JOB,handle:FILE}}};
      case '/bridge/tx/browse':
        done=true;return {status:200,body:{deviceId:DEVICE,jobId:JOB,state:'done'}};
      default:
        return {status:200,body:{jobId:JOB,state:done?'done':'queued'}};
    }
  };
  const post=await serve(t,handler,diagnostics);
  assert.equal((await post('/bridge/admin/browse',{deviceId:DEVICE,handle:FILE})).status,202);
  const before=await post('/bridge/admin/status',{jobId:JOB});
  assert.equal(before.body.state,'queued');
  const poll=await post('/bridge/tx/poll',{deviceId:DEVICE,sessionToken:SECRET});
  assert.equal(poll.body.job.handle,FILE);
  assert.equal((await post('/bridge/tx/browse',{
    deviceId:DEVICE,jobId:JOB,sessionToken:SECRET,entries:[{name:FILE}]
  })).body.state,'done');
  assert.equal((await post('/bridge/admin/status',{jobId:JOB})).body.state,'done');
  const results=records.filter(x=>x.phase==='result');
  assert.equal(results.length,5);
  assert.equal(new Set(results.map(x=>x.job)).size,1);
  assert.equal(results[2].hasJob,true);
  assert.equal(records.filter(x=>x.phase==='finished').length,5);
  for(const value of [DEVICE,JOB,SECRET,FILE])
    assert.equal(JSON.stringify(records).includes(value),false);
});
test('HTTP rejections and thrown exceptions are sanitized, without changing their statuses',async t=>{
  const {records,diagnostics}=capture();
  const post=await serve(t,async()=>{throw Error(SECRET+FILE);},diagnostics);
  assert.deepEqual(await post('/bridge/tx/connect',{deviceId:DEVICE,deviceSecret:SECRET}),
    {status:503,body:{error:'bridge_unavailable'}});
  assert.equal((await post('/bridge/admin/status',{},{
    origin:'https://not-allowed.example'
  })).status,403);
  assert.equal((await post('/bridge/owner/enroll',{data:'x'.repeat(3000)})).status,413);
  assert.deepEqual(records.filter(x=>x.phase==='result').map(x=>x.error),
    ['bridge_unavailable','origin_denied','payload_too_large']);
  for(const value of [DEVICE,SECRET,FILE,'not-allowed'])
    assert.equal(JSON.stringify(records).includes(value),false);
});
test('broken diagnostic output cannot change successful HTTP responses',async t=>{
  const diagnostics=createBridgeRequestDiagnostics({sink:()=>{throw Error(SECRET);}});
  const expected={status:200,body:{deviceId:DEVICE,jobId:JOB,state:'queued'}};
  const post=await serve(t,async()=>expected,diagnostics);
  assert.deepEqual(await post('/bridge/admin/status',{jobId:JOB}),expected);
});
test('default gateway needs no diagnostics and staging validates opt-in before DB construction',async t=>{
  const post=await serve(t,async()=>({status:200,body:{ok:true}}),undefined);
  assert.deepEqual(await post('/bridge/admin/status'),{status:200,body:{ok:true}});
  const env={
    FREEPT_BRIDGE_STAGING:'I_UNDERSTAND_LOCAL_TEST_ONLY',
    FREEPT_BRIDGE_PUBLIC:'I_UNDERSTAND_STAGING_HTTPS_ONLY',
    FREEPT_BRIDGE_ALLOWED_ORIGINS:'https://localhost',
    FREEPT_BRIDGE_TEST_SUPABASE_URL:'https://freept-bridge-disposable-ci.supabase.co',
    FREEPT_BRIDGE_TEST_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_'+'a'.repeat(24),
    FREEPT_BRIDGE_TEST_SUPABASE_SERVICE_ROLE_KEY:'sb_secret_'+'b'.repeat(24),
    FREEPT_BRIDGE_DIAGNOSTICS:'wrong',
    PORT:'10000'
  };
  assert.throws(()=>createBridgeStagingHttpsService({
    env,createClientFn:()=>{throw Error('database_must_not_be_called');}
  }),/bridge_diagnostics_opt_in_invalid/);
});
