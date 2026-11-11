import test from 'node:test';
import assert from 'node:assert/strict';
import {BridgePostgresJobsAdapter} from './postgresJobsAdapter.mjs';
import {createBridgeAdminRequestHandler} from './adminRequestHandler.mjs';
import {createBridgeTxRequestHandler} from './txRequestHandler.mjs';
import {createBridgeFolderTransmitter} from '../src/bridgeTxFolderClient.js';
import {createBridgeRemoteFolderLister} from '../src/bridgeBrowseClient.js';
const DEVICE='11111111-1111-4111-8111-111111111111';
const ADMIN='22222222-2222-4222-8222-222222222222';
const FOLDER='33333333-3333-4333-8333-333333333333';
const FILE='44444444-4444-4444-8444-444444444444';
const JOB='55555555-5555-4555-8555-555555555555';
const BIND='a'.repeat(64),TOKEN='b'.repeat(64),BEARER='c'.repeat(40);
const entries=[{handle:FILE,name:'test.jpg',directory:false,size:3,mime:'image/jpeg'}];
function fixture(){
 const calls=[];let folderPage=null;
 const rpcClient={rpc:async(name,args)=>{
  calls.push({name,args});
  if(name==='bridge_server_enqueue_browse')return {data:JOB,error:null};
  if(name==='bridge_server_claim_list'||name==='bridge_server_claim_read')return {data:null,error:null};
  if(name==='bridge_server_claim_browse')return {data:{jobId:JOB,deviceId:DEVICE,operation:'browse',state:'sent',handle:FOLDER,offset:0},error:null};
  if(name==='bridge_server_complete_browse_page'){folderPage={entries:args.p_entries,nextOffset:args.p_next_offset};return {data:true,error:null}}
  if(name==='bridge_server_read_browse_page')return {data:folderPage,error:null};
  throw Error('unexpected '+name);
 }};
 const adapter=new BridgePostgresJobsAdapter({rpcClient,readJobsEnabled:true,
  sessions:{getDispatchBinding:async({deviceId,token})=>{
   if(deviceId!==DEVICE||token!==TOKEN)throw Error('invalid_device_session');
   return BIND;
  }},
  authenticateAdmin:async ctx=>ctx?.accessToken===BEARER?{id:ADMIN,approved:true,role:'admin'}:null
 });
 const service={requestList:async()=>{},getRequestStatus:async()=>{},cancelRequest:async()=>{},
  requestBrowse:params=>adapter.requestBrowse(params),getBrowsePage:params=>adapter.getBrowsePage(params),
  pollDevice:params=>adapter.pollDevice(params),completeBrowsePage:params=>adapter.completeBrowsePage(params),
  connectDevice:async()=>{},completeDevice:async()=>{}
 };
 return {adapter,calls,service,
  admin:createBridgeAdminRequestHandler({service,newJobId:()=>JOB}),
  tx:createBridgeTxRequestHandler({service})};
}
test('browse queue: authorized admin, session-bound TX and isolated page retrieval',async()=>{
 const f=fixture();
 const response=await f.admin({method:'POST',path:'/bridge/admin/browse',
  headers:{authorization:'Bearer '+BEARER},
  body:{deviceId:DEVICE,handle:FOLDER,offset:0}});
 assert.equal(response.status,202);
 const item=await f.adapter.pollDevice({deviceId:DEVICE,sessionToken:TOKEN});
 assert.equal(item.operation,'browse');assert.equal(item.handle,FOLDER);
 assert.equal(item.offset,0);
 const done=await f.tx({method:'POST',path:'/bridge/tx/browse',
  body:{deviceId:DEVICE,sessionToken:TOKEN,jobId:JOB,entries,nextOffset:-1}});
 assert.equal(done.status,200);
 const result=await f.admin({method:'POST',path:'/bridge/admin/browse-page',
  headers:{authorization:'Bearer '+BEARER},body:{jobId:JOB}});
 assert.equal(result.status,200);assert.deepEqual(result.body.entries,entries);
 assert.ok(f.calls.some(x=>x.name==='bridge_server_enqueue_browse'));
 assert.equal(JSON.stringify(f.calls).includes(TOKEN),false);
});
test('unapproved admin and wrong TX session cannot browse folders',async()=>{
 const f=fixture();
 const bad=await f.admin({method:'POST',path:'/bridge/admin/browse',
  headers:{authorization:'Bearer '+'d'.repeat(40)},
  body:{deviceId:DEVICE,handle:FOLDER,offset:0}});
 assert.equal(bad.status,403);
 const wrong=await f.tx({method:'POST',path:'/bridge/tx/browse',
  body:{deviceId:DEVICE,sessionToken:'d'.repeat(64),jobId:JOB,entries,nextOffset:-1}});
 assert.equal(wrong.status,403);
});
test('remote page orchestration waits for completion, then returns exact page',async()=>{
 const requested=[];let polls=0;
 const lister=createBridgeRemoteFolderLister({deviceId:DEVICE,pause:async()=>{},api:{
  async requestBrowse(dev,request){requested.push(request);return {jobId:JOB,deviceId:dev,state:'queued'}},
  async getStatus(){return {jobId:JOB,deviceId:DEVICE,state:++polls===1?'sent':'done'}},
  async getBrowsePage(){return {jobId:JOB,entries,nextOffset:-1}}
 }});
 assert.deepEqual(await lister({handle:FOLDER,offset:0}),{entries,nextOffset:-1});
 assert.deepEqual(requested,[{handle:FOLDER,offset:0}]);assert.equal(polls,2);
});
test('TX uses requested nested handle, never silently falls back to root',async()=>{
 const observed=[];
 const replies={connect:{token:TOKEN,expiresAt:Date.now()+60000},
  poll:{job:{jobId:JOB,deviceId:DEVICE,operation:'browse',state:'sent',handle:FOLDER,offset:0}},
  browse:{jobId:JOB,deviceId:DEVICE,state:'done'}};
 const tx=createBridgeFolderTransmitter({baseUrl:'https://bridge-test.example',
  deviceId:DEVICE,deviceSecret:'e'.repeat(64),
  folderProvider:{list:async req=>{observed.push(req);return {entries,nextOffset:-1}}},
  fetchImpl:async(url)=>({ok:true,json:async()=>replies[url.split('/').at(-1)]})
 });
 await tx.connect();assert.equal(await tx.processOne(),true);
 assert.deepEqual(observed,[{handle:FOLDER,offset:0}]);
});


test('remote folder lister rejects repeated offsets rather than trapping browser in endless pagination',async()=>{
 const entries=Array.from({length:100},(_,i)=>({
  handle:'11111111-1111-4111-8111-'+String(i).padStart(12,'0'),
  name:'file-'+i,directory:false,size:1,mime:'application/octet-stream'
 }));
 const lister=createBridgeRemoteFolderLister({deviceId:DEVICE,pause:async()=>{},api:{
  async requestBrowse(){return {jobId:JOB,deviceId:DEVICE,state:'queued'}},
  async getStatus(){return {jobId:JOB,deviceId:DEVICE,state:'done'}},
  async getBrowsePage(){return {jobId:JOB,entries,nextOffset:0}}
 }});
 await assert.rejects(lister({handle:'root',offset:0}),/pagination_loop/);
});
