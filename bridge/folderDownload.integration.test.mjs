import test from 'node:test';
import assert from 'node:assert/strict';
import {downloadBridgeFolder} from '../src/bridgeFolderDownloadClient.js';
const DEVICE='11111111-1111-4111-8111-111111111111';
const FOLDER='22222222-2222-4222-8222-222222222222';
const FILE_A='33333333-3333-4333-8333-333333333333';
const FILE_B='44444444-4444-4444-8444-444444444444';
const JOB='55555555-5555-4555-8555-555555555555';
const entry=(handle,name,directory=false,size=0)=>({handle,name,directory,size:directory?-1:size,mime:directory?'vnd.android.document/directory':'application/octet-stream'});
const page=entries=>({entries,nextOffset:-1});
function makeFixture({failFile=null}={}){
 const data=new Map([[FILE_A,Buffer.from([0,255,10])],[FILE_B,Buffer.alloc(40000,42)]]);
 const catalog=new Map([
  ['root',page([entry(FOLDER,'Photos',true),entry(FILE_A,'test.bin',false,3)])],
  [FOLDER,page([entry(FILE_B,'large.bin',false,40000)])]
 ]);
 const events=[],written=new Map(),requests=[];
 let lastRequest=null;
 const api={
  async requestRead(deviceId,req){assert.equal(deviceId,DEVICE);lastRequest=req;requests.push(req);return {jobId:JOB,deviceId:DEVICE,state:'queued'}},
  async getStatus(){return {jobId:JOB,deviceId:DEVICE,state:'done'}},
  async getReadChunk(){const bytes=data.get(lastRequest.handle).subarray(lastRequest.offset,lastRequest.offset+lastRequest.length);
   return {base64:bytes.toString('base64'),bytesRead:bytes.length,eof:lastRequest.offset+bytes.length===data.get(lastRequest.handle).length}},
  async cancel(){}
 };
 const destination={
  async begin(){events.push('begin')},
  async makeDirectory(path){events.push('mkdir:'+path.join('/'))},
  async openFile(path){
   const key=path.join('/');events.push('open:'+key);
   if(key===failFile)throw Error('storage_full');
   const chunks=[];
   return {
    async write(bytes){chunks.push(Buffer.from(bytes))},
    async commit(){written.set(key,Buffer.concat(chunks));events.push('file_commit:'+key)},
    async discard(){events.push('file_discard:'+key)}
   };
  },
  async commit(){events.push('folder_commit')},
  async discard(){events.push('folder_discard');written.clear()}
 };
 return {api,destination,events,written,requests,listPage:async({handle,offset})=>{
  assert.equal(offset,0);if(!catalog.has(handle))throw Error('unknown_handle');return catalog.get(handle);
 }};
}
test('downloads selected folder recursively, nested 40KB and root file, commits only at end',async()=>{
 const f=makeFixture();
 const result=await downloadBridgeFolder({
  api:f.api,deviceId:DEVICE,listPage:f.listPage,destination:f.destination,pause:async()=>{}
 });
 assert.deepEqual(result,{entries:3,files:2});
 assert.equal(f.written.get('test.bin').toString('hex'),'00ff0a');
 assert.equal(f.written.get('Photos/large.bin').length,40000);
 assert.ok(f.written.get('Photos/large.bin').every(b=>b===42));
 assert.equal(f.requests.length,3);
 assert.deepEqual(f.requests.filter(x=>x.handle===FILE_B).map(x=>x.offset),[0,32768]);
 assert.equal(f.events.at(-1),'folder_commit');
 assert.equal(f.events.includes('folder_discard'),false);
});
test('storage error rolls back whole folder rather than leaving partial files',async()=>{
 const f=makeFixture({failFile:'test.bin'});
 await assert.rejects(downloadBridgeFolder({
  api:f.api,deviceId:DEVICE,listPage:f.listPage,destination:f.destination,pause:async()=>{}
 }),/storage_full/);
 assert.equal(f.events.at(-1),'folder_discard');
 assert.equal(f.written.size,0);
 assert.equal(f.events.includes('folder_commit'),false);
});
test('unsafe directory name is rejected before destination creation',async()=>{
 const f=makeFixture();
 let touched=false;
 await assert.rejects(downloadBridgeFolder({
  api:f.api,deviceId:DEVICE,
  listPage:async()=>page([entry(FILE_A,'../escape',false,3)]),
  destination:{...f.destination,begin:async()=>{touched=true}},pause:async()=>{}
 }),/metadata_invalid/);
 assert.equal(touched,false);
});
test('source catalogue failure does not open destination',async()=>{
 const f=makeFixture();
 let touched=false;
 await assert.rejects(downloadBridgeFolder({
  api:f.api,deviceId:DEVICE,listPage:async()=>{throw Error('offline')},
  destination:{...f.destination,begin:async()=>{touched=true}}
 }),/offline/);
 assert.equal(touched,false);
});
