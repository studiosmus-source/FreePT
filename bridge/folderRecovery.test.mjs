import test from 'node:test';
import assert from 'node:assert/strict';
import {downloadBridgeFile} from '../src/bridgeDownloadClient.js';
import {downloadBridgeFolder} from '../src/bridgeFolderDownloadClient.js';
import {createBridgeAdminClient} from '../src/bridgeAdminClient.js';
const DEVICE='11111111-1111-4111-8111-111111111111';
const FILE='22222222-2222-4222-8222-222222222222';
const JOB='33333333-3333-4333-8333-333333333333';
const options={deviceId:DEVICE,handle:FILE,pause:async()=>{}};
function fileFixture(){
 const events=[],requests=[];
 const api={
  async requestRead(_device,range){requests.push(range);return {jobId:JOB,deviceId:DEVICE};},
  async getStatus(){return {jobId:JOB,deviceId:DEVICE,state:'done'};},
  async getReadChunk(){const n=requests.at(-1).length;return {base64:Buffer.alloc(n,42).toString('base64'),bytesRead:n,eof:true};},
  async cancel(){events.push('cancel');return {jobId:JOB,deviceId:DEVICE,state:'cancelled'};}
 };
 return {api,events,requests,destination:{
  async write(bytes,offset){events.push(['write',offset,bytes.length]);},
  async commit(){events.push('commit');},async discard(){events.push('discard');}
 }};
}
test('a slow TX taking more than the old 42-second limit still completes',async()=>{
 const f=fileFixture();let polls=0,clock=0;
 f.api.getStatus=async()=>({jobId:JOB,deviceId:DEVICE,state:++polls<85?'queued':'done'});
 await downloadBridgeFile({...options,...f,size:3,now:()=>clock,pause:async ms=>{clock+=ms;}});
 assert.ok(clock>42000);assert.ok(clock<75000);
 assert.equal(f.requests.length,1);assert.equal(f.events.at(-1),'commit');
});
test('transient status and chunk errors retry the SAME job without rerequesting bytes',async()=>{
 const f=fileFixture();let status=0,chunk=0;
 const get=f.api.getReadChunk;
 f.api.getStatus=async()=>{
  if(++status<3)throw Error('bridge_backend_unavailable');
  return {jobId:JOB,deviceId:DEVICE,state:'done'};
 };
 f.api.getReadChunk=async()=>{
  if(++chunk<3)throw Error('bridge_network_unavailable');
  return get();
 };
 await downloadBridgeFile({...options,...f,size:3});
 assert.equal(f.requests.length,1);
 assert.deepEqual(f.events,[['write',0,3],'commit']);
});
test('a timed-out job must be confirmed cancelled before repeating the same byte range',async()=>{
 const f=fileFixture();let polls=0;
 f.api.getStatus=async()=>({jobId:JOB,deviceId:DEVICE,state:++polls<=2?'queued':'done'});
 await downloadBridgeFile({...options,...f,size:3,maxPolls:2});
 assert.deepEqual(f.events,['cancel',['write',0,3],'commit']);
 assert.deepEqual(f.requests,[{handle:FILE,offset:0,length:3},{handle:FILE,offset:0,length:3}]);
});
test('uncertain cancellation or ambiguous enqueue is never blindly replayed',async()=>{
 const f=fileFixture();
 f.api.getStatus=async()=>({jobId:JOB,deviceId:DEVICE,state:'queued'});
 f.api.cancel=async()=>{throw Error('bridge_network_unavailable');};
 await assert.rejects(downloadBridgeFile({...options,...f,size:3,maxPolls:1}),/timeout/);
 assert.equal(f.requests.length,1);
 const g=fileFixture();let enqueued=0;
 g.api.requestRead=async()=>{enqueued++;throw Error('bridge_http_timeout');};
 await assert.rejects(downloadBridgeFile({...options,...g,size:3}),/http_timeout/);
 assert.equal(enqueued,1);assert.deepEqual(g.events,['discard']);
});
test('expiry retries a known terminal read without discarding earlier bytes',async()=>{
 const f=fileFixture();let status=0;
 f.api.getStatus=async()=>({jobId:JOB,deviceId:DEVICE,state:++status===1?'expired':'done'});
 await downloadBridgeFile({...options,...f,size:3});
 assert.equal(f.requests.length,2);assert.equal(f.events.at(-1),'commit');
});
test('authorization failures do not retry retrieval or publish a partial file',async()=>{
 const f=fileFixture();let reads=0;
 f.api.getStatus=async()=>{reads++;throw Error('bridge_auth_required');};
 await assert.rejects(downloadBridgeFile({...options,...f,size:3}),/auth_required/);
 assert.equal(reads,1);assert.equal(f.events.includes('commit'),false);
});
test('HTTP timeout and explicit user abort remain distinct and enqueue is sent only once',async()=>{
 const auth={async getSession(){return {data:{session:{access_token:'test-token-placeholder'.repeat(3)}}};}};
 let sent=0;
 const client=createBridgeAdminClient({baseUrl:'https://bridge.example.test',auth,requestTimeoutMs:5,
  fetchImpl:async(_url,{signal})=>{sent++;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));}});
 await assert.rejects(client.requestRead(DEVICE,{handle:FILE,offset:0,length:3}),/bridge_http_timeout/);
 assert.equal(sent,1);
 const abort=new AbortController();
 const pending=client.getStatus(JOB,{signal:abort.signal});
 abort.abort();
 await assert.rejects(pending,/bridge_transfer_cancelled/);
});
function folderFixture(count,{failureAt=-1,failure='bridge_download_timeout'}={}){
 let currentFile=0,failed=false;
 const events=[],opened=[],completed=[];
 const id=i=>`${(i+10).toString(16).padStart(8,'0')}-2222-4222-8222-222222222222`;
 let range;
 const api={
  async requestRead(_device,r){
   range=r;currentFile=Number.parseInt(r.handle.slice(0,8),16)-10;
   if(currentFile===failureAt&&!failed){failed=true;throw Error(failure);}
   return {jobId:JOB,deviceId:DEVICE};
  },
  async getStatus(){return {jobId:JOB,deviceId:DEVICE,state:'done'};},
  async getReadChunk(){return {base64:'YWJj',bytesRead:3,eof:true};},
  async cancel(){return {jobId:JOB,deviceId:DEVICE,state:'cancelled'};}
 };
 const listPage=async({offset})=>{
  const entries=Array.from({length:Math.min(100,count-offset)},(_,n)=>({
   handle:id(offset+n),name:`file-${offset+n}.bin`,directory:false,size:3,mime:'application/octet-stream'
  }));
  return {entries,nextOffset:offset+100<count?offset+100:-1};
 };
 const destination={
  async begin(){events.push('begin');},async makeDirectory(){},
  async openFile(path){
   opened.push(path[0]);
   return {async write(){},async commit(){completed.push(path[0]);},async discard(){events.push('discard-file:'+path[0]);}};
  },
  async commit({partial}){events.push(partial?'partial':'full');return {name:partial?'download (parziale)':'download'};},
  async discard(){events.push('rollback');}
 };
 return {api,listPage,destination,events,opened,completed};
}
test('a 1,200-file folder completes without an overall folder time limit',async()=>{
 const f=folderFixture(1200);let virtualMs=0;
 const status=f.api.getStatus;
 f.api.getStatus=async()=>{virtualMs+=900;return status();};
 const result=await downloadBridgeFolder({...f,deviceId:DEVICE,pause:async()=>{}});
 assert.equal(result.files,1200);assert.equal(f.completed.length,1200);
 assert.ok(virtualMs>15*60*1000);assert.equal(f.events.at(-1),'full');
});
test('retrying an interrupted folder resumes at the failed file, not at file zero',async()=>{
 const f=folderFixture(350,{failureAt:205}),pauses=[];
 const result=await downloadBridgeFolder({...f,deviceId:DEVICE,pause:async()=>{},
  onInterruption:async p=>{pauses.push(p);return true;},preserveCompletedOnFailure:true});
 assert.equal(result.files,350);assert.equal(pauses.length,1);
 assert.equal(pauses[0].completedFiles,205);
 assert.deepEqual(f.opened.slice(203,208),['file-203.bin','file-204.bin','file-205.bin','file-205.bin','file-206.bin']);
 assert.equal(f.completed.length,350);assert.equal(f.events.at(-1),'full');
});
test('an exhausted transport failure can publish only verified completed files as partial',async()=>{
 const f=folderFixture(5,{failureAt:3});
 const result=await downloadBridgeFolder({...f,deviceId:DEVICE,pause:async()=>{},preserveCompletedOnFailure:true});
 assert.equal(result.partial,true);assert.equal(result.files,3);
 assert.equal(result.interruptedBy,'transient_read');assert.equal(f.events.at(-1),'partial');
 assert.ok(f.events.includes('discard-file:file-3.bin'));
 assert.equal(f.events.includes('rollback'),false);
});
test('permission loss never invokes retry UI or preserves a purported complete folder',async()=>{
 const f=folderFixture(5,{failureAt:3,failure:'bridge_auth_required'});
 let retryPrompts=0;
 await assert.rejects(downloadBridgeFolder({...f,deviceId:DEVICE,pause:async()=>{},preserveCompletedOnFailure:true,
  onInterruption:async()=>{retryPrompts++;return true;}}),/auth_required/);
 assert.equal(retryPrompts,0);assert.equal(f.events.at(-1),'rollback');
});
test('cancelling while waiting to resume saves previous complete files only',async()=>{
 const f=folderFixture(5,{failureAt:2}),controller=new AbortController();
 const result=await downloadBridgeFolder({...f,deviceId:DEVICE,pause:async()=>{},signal:controller.signal,
  preserveCompletedOnCancel:true,preserveCompletedOnFailure:true,
  onInterruption:async()=>{controller.abort();return false;}});
 assert.equal(result.files,2);assert.equal(result.interruptedBy,'user_cancel');
 assert.equal(f.events.at(-1),'partial');
});
