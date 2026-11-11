import test from 'node:test';
import assert from 'node:assert/strict';
import {BridgePostgresJobsAdapter} from './postgresJobsAdapter.mjs';
import {createBridgeAdminRequestHandler} from './adminRequestHandler.mjs';
import {createBridgeTxRequestHandler} from './txRequestHandler.mjs';
import {createBridgeFolderTransmitter} from '../src/bridgeTxFolderClient.js';
const DEVICE='11111111-1111-4111-8111-111111111111';
const ADMIN='22222222-2222-4222-8222-222222222222';
const JOB='33333333-3333-4333-8333-333333333333';
const HANDLE='44444444-4444-4444-8444-444444444444';
const BIND='a'.repeat(64), TOKEN='b'.repeat(64),BEARER='c'.repeat(40);
const CHUNK={base64:'AQID',bytesRead:3,eof:false};
function fixture(enabled=true){
  const calls=[];
  let revoked=false;
  const rpcClient={async rpc(name,args){
    calls.push({name,args});
    if(revoked)return {data:null,error:{code:'42501'}};
    if(name==='bridge_server_enqueue_read')return {data:JOB,error:null};
    if(name==='bridge_server_claim_list')return {data:null,error:null};
    if(name==='bridge_server_claim_read')return {data:{jobId:JOB,deviceId:DEVICE,operation:'read',state:'sent',handle:HANDLE,offset:0,length:3},error:null};
    if(name==='bridge_server_complete_read')return {data:true,error:null};
    if(name==='bridge_server_read_chunk')return {data:CHUNK,error:null};
    throw Error('unexpected '+name);
  }};
  const adapter=new BridgePostgresJobsAdapter({
    rpcClient,
    sessions:{getDispatchBinding:async({deviceId,token})=>{
      if(deviceId!==DEVICE||token!==TOKEN)throw Error('invalid_device_session');
      return BIND;
    }},
    authenticateAdmin:async ctx=>ctx?.accessToken===BEARER?{id:ADMIN,role:'admin',approved:true}:null,
    readJobsEnabled:enabled
  });
  const service={requestList:async()=>{},getRequestStatus:async()=>{},
    cancelRequest:async()=>{},requestRead:x=>adapter.requestRead(x),
    getReadChunk:x=>adapter.getReadChunk(x),
    pollDevice:x=>adapter.pollDevice(x),
    completeDevice:async()=>{},completeRead:x=>adapter.completeRead(x),
    connectDevice:async()=>{},completeFolderPage:async()=>{}};
  return {adapter,calls,admin:createBridgeAdminRequestHandler({service,newJobId:()=>JOB}),
    tx:createBridgeTxRequestHandler({service}),revoke:()=>{revoked=true}};
}
const req=(path,body,token=BEARER)=>({path,method:'POST',
  headers:{authorization:'Bearer '+token},body});
test('read job passes authenticated admin enqueue, TX dispatch and chunk retrieval',async()=>{
  const f=fixture();
  const queued=await f.admin(req('/bridge/admin/read',{deviceId:DEVICE,handle:HANDLE,offset:0,length:3}));
  assert.equal(queued.status,202);
  assert.equal(queued.body.jobId,JOB);
  const claim=await f.adapter.pollDevice({deviceId:DEVICE,sessionToken:TOKEN});
  assert.equal(claim.operation,'read');assert.equal(claim.handle,HANDLE);
  const completed=await f.tx({method:'POST',path:'/bridge/tx/chunk',
    body:{deviceId:DEVICE,sessionToken:TOKEN,jobId:JOB,chunk:CHUNK}});
  assert.equal(completed.status,200);
  const read=await f.admin(req('/bridge/admin/chunk',{jobId:JOB}));
  assert.deepEqual(read,{status:200,body:CHUNK});
  assert.ok(f.calls.some(x=>x.name==='bridge_server_enqueue_read'));
  assert.ok(f.calls.some(x=>x.name==='bridge_server_complete_read'));
  assert.equal(JSON.stringify(f.calls).includes(TOKEN),false);
});
test('read disabled by default and malformed requests fail closed',async()=>{
 const f=fixture(false);
 const blocked=await f.admin(req('/bridge/admin/read',{deviceId:DEVICE,handle:HANDLE,offset:0,length:3}));
 assert.equal(blocked.status,500);
 assert.equal(f.calls.length,0);
 const invalid=await f.admin(req('/bridge/admin/read',{deviceId:DEVICE,handle:HANDLE,offset:0,length:40000}));
 assert.equal(invalid.status,400);
 assert.equal(f.calls.length,0);
});
test('wrong session and revoked grant cannot deliver bytes',async()=>{
 const f=fixture();
 const wrong=await f.tx({method:'POST',path:'/bridge/tx/chunk',
  body:{deviceId:DEVICE,sessionToken:'d'.repeat(64),jobId:JOB,chunk:CHUNK}});
 assert.equal(wrong.status,403);
 f.revoke();
 const denied=await f.admin(req('/bridge/admin/chunk',{jobId:JOB}));
 assert.equal(denied.status,500);
 assert.equal(f.calls.some(x=>x.name==='bridge_server_read_chunk'),true);
});
test('TX client reads a real bounded SAF chunk and posts bytes only for read job',async()=>{
 const requests=[],data=Buffer.from([1,2,3]);
 const replies={
  connect:{token:TOKEN,expiresAt:Date.now()+60000},
  poll:{job:{jobId:JOB,deviceId:DEVICE,operation:'read',state:'sent',handle:HANDLE,offset:0,length:3}},
  chunk:{jobId:JOB,deviceId:DEVICE,state:'done'}
 };
 const transmitter=createBridgeFolderTransmitter({baseUrl:'https://bridge-test.example',
  deviceId:DEVICE,deviceSecret:'e'.repeat(64),
  folderProvider:{list:async()=>{throw Error('unexpected list')},
    readChunk:async req=>{assert.deepEqual(req,{handle:HANDLE,offset:0,length:3});return {base64:data.toString('base64'),bytesRead:3,eof:false}}},
  fetchImpl:async(url,options)=>{
    const action=url.split('/').at(-1),body=JSON.parse(options.body);
    requests.push({action,body});
    return {ok:true,json:async()=>replies[action]};
  }
 });
 await transmitter.connect();
 assert.equal(await transmitter.processOne(),true);
 assert.deepEqual(Buffer.from(requests.find(x=>x.action==='chunk').body.chunk.base64,'base64'),data);
});
