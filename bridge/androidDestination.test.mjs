import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createBridgeAndroidFolderDestination,createBridgeAndroidSingleFileWriter} from '../src/bridgeAndroidDestination.js';
import {downloadBridgeFile} from '../src/bridgeDownloadClient.js';
import {downloadBridgeFolder} from '../src/bridgeFolderDownloadClient.js';

const DEVICE='11111111-1111-4111-8111-111111111111';
const FOLDER='22222222-2222-4222-8222-222222222222';
const FILE='33333333-3333-4333-8333-333333333333';
const JOB='44444444-4444-4444-8444-444444444444';
function fakePlugin({writeFails=false}={}){
  const calls=[];
  const plugin={
    beginFolder:async params=>{calls.push(['begin',params]);return {started:true}},
    makeDirectory:async params=>{calls.push(['mkdir',params])},
    openFile:async params=>{calls.push(['open',params]);return {fileId:FILE}},
    writeChunk:async params=>{
      calls.push(['write',params]);
      if(writeFails)throw Error('write_failed');
      return {written:params.offset+Buffer.from(params.base64,'base64').length};
    },
    commitFile:async params=>{calls.push(['commitFile',params])},
    discardFile:async params=>{calls.push(['discardFile',params])},
    commitFolder:async()=>{calls.push(['commitFolder'])},
    discardFolder:async()=>{calls.push(['discardFolder'])}
  };
  return {plugin,calls};
}
test('SAF destination uses selected tree staging for binary folder download',async()=>{
 const f=fakePlugin();
 const destination=createBridgeAndroidFolderDestination({plugin:f.plugin,name:'Remote Photos'});
 const payload=Buffer.from([0,255,128,1]);
 const api={
  async requestRead(){return {jobId:JOB,deviceId:DEVICE,state:'queued'}},
  async getStatus(){return {jobId:JOB,deviceId:DEVICE,state:'done'}},
  async getReadChunk(){return {base64:payload.toString('base64'),bytesRead:payload.length,eof:true}},
  async cancel(){}
 };
 const result=await downloadBridgeFolder({
  api,deviceId:DEVICE,destination,pause:async()=>{},
  listPage:async({handle})=>handle==='root'
   ? {entries:[{handle:FOLDER,name:'Sub',directory:true,size:-1,mime:'vnd.android.document/directory'}],nextOffset:-1}
   : {entries:[{handle:FILE,name:'binary.bin',directory:false,size:4,mime:'application/octet-stream'}],nextOffset:-1}
 });
 assert.equal(result.files,1);
 assert.deepEqual(f.calls.map(x=>x[0]),['begin','mkdir','open','write','commitFile','commitFolder']);
 assert.deepEqual(f.calls.find(x=>x[0]==='mkdir')[1].path,['Sub']);
 assert.deepEqual(f.calls.find(x=>x[0]==='open')[1].path,['Sub','binary.bin']);
 assert.deepEqual(Buffer.from(f.calls.find(x=>x[0]==='write')[1].base64,'base64'),payload);
});
test('write failure discards file and entire staging folder',async()=>{
 const f=fakePlugin({writeFails:true});
 const destination=createBridgeAndroidFolderDestination({plugin:f.plugin,name:'Remote'});
 const api={
  async requestRead(){return {jobId:JOB,deviceId:DEVICE,state:'queued'}},
  async getStatus(){return {jobId:JOB,deviceId:DEVICE,state:'done'}},
  async getReadChunk(){return {base64:'AQID',bytesRead:3,eof:true}},
  async cancel(){}
 };
 await assert.rejects(downloadBridgeFolder({
  api,deviceId:DEVICE,destination,pause:async()=>{},
  listPage:async()=>({entries:[{handle:FILE,name:'test.dat',directory:false,size:3,mime:'application/octet-stream'}],nextOffset:-1})
 }),/write_failed/);
 assert.deepEqual(f.calls.map(x=>x[0]),['begin','open','write','discardFile','discardFolder']);
});
test('destination validates names before opening storage',async()=>{
 const f=fakePlugin();
 assert.throws(()=>createBridgeAndroidFolderDestination({plugin:f.plugin,name:'../other'}),/invalid_options/);
 const dest=createBridgeAndroidFolderDestination({plugin:f.plugin,name:'safe'});
 await dest.begin();
 await assert.rejects(dest.makeDirectory(['..']),/invalid_path/);
 assert.equal(f.calls.some(x=>x[0]==='mkdir'),false);
 await dest.discard();
});
test('native template remains scoped to SAF and temporary destination',()=>{
 const java=readFileSync(new URL('../android-bridge/BridgeDestinationPlugin.java.template',import.meta.url),'utf8');
 const installer=readFileSync(new URL('../android-bridge/install.py',import.meta.url),'utf8');
 assert.match(java,/ACTION_OPEN_DOCUMENT_TREE/);
 assert.match(java,/DocumentsContract\.createDocument/);
 assert.match(java,/DocumentsContract\.renameDocument/);
 assert.match(java,/DocumentsContract\.deleteDocument/);
 assert.match(java,/MAX_CHUNK=262144/);
 assert.doesNotMatch(java,/MANAGE_EXTERNAL_STORAGE/);
 assert.match(installer,/BridgeDestinationPlugin\.class/);
});

test('individual file is written directly to selected SAF folder and atomically committed',async()=>{
 const events=[],bytes=Buffer.from([0,1,255,17]);
 const plugin={
  beginSingleFile:async args=>{events.push(['beginSingleFile',args]);return {fileId:FILE}},
  writeChunk:async args=>{events.push(['write',args]);return {written:args.offset+Buffer.from(args.base64,'base64').length}},
  commitFile:async args=>events.push(['commitFile',args]),
  commitSingleFile:async()=>events.push(['commitSingleFile']),
  discardSingleFile:async()=>events.push(['discardSingleFile'])
 };
 const dest=await createBridgeAndroidSingleFileWriter({plugin,name:'test.bin',size:4,mime:'application/octet-stream'});
 const api={
  async requestRead(){return {jobId:JOB,deviceId:DEVICE,state:'queued'}},
  async getStatus(){return {jobId:JOB,deviceId:DEVICE,state:'done'}},
  async getReadChunk(){return {base64:bytes.toString('base64'),bytesRead:4,eof:true}},
  async cancel(){}
 };
 await downloadBridgeFile({api,deviceId:DEVICE,handle:FILE,size:4,destination:dest,pause:async()=>{}});
 assert.deepEqual(events.map(x=>x[0]),['beginSingleFile','write','commitFile','commitSingleFile']);
 assert.deepEqual(Buffer.from(events[1][1].base64,'base64'),bytes);
});
test('single-file transfer rollback deletes temporary document on error',async()=>{
 const events=[],plugin={
  beginSingleFile:async()=>({fileId:FILE}),
  writeChunk:async()=>{throw Error('disk_full')},
  commitFile:async()=>events.push('commitFile'),
  commitSingleFile:async()=>events.push('commitSingleFile'),
  discardSingleFile:async()=>events.push('discardSingleFile')
 };
 const dest=await createBridgeAndroidSingleFileWriter({plugin,name:'x.dat',size:3,mime:'application/octet-stream'});
 const api={
  async requestRead(){return {jobId:JOB,deviceId:DEVICE,state:'queued'}},
  async getStatus(){return {jobId:JOB,deviceId:DEVICE,state:'done'}},
  async getReadChunk(){return {base64:'AQID',bytesRead:3,eof:true}},
  async cancel(){}
 };
 await assert.rejects(downloadBridgeFile({api,deviceId:DEVICE,handle:FILE,size:3,
   destination:dest,pause:async()=>{}}),/disk_full/);
 assert.deepEqual(events,['discardSingleFile']);
});

test('Android destination rejects preexisting names before staging and before final rename',()=>{
 const java=readFileSync(new URL('../android-bridge/BridgeDestinationPlugin.java.template',import.meta.url),'utf8');
 assert.match(java,/private boolean targetExists\(String requestedName\)/);
 assert.match(java,/private String availableName\(String requestedName\)/);
 assert.match(java,/String suffix=" \("\+index\+"\)"/);
 assert.match(java,/encoded.length\(\)>349528/);
 assert.match(java,/DocumentsContract\.buildChildDocumentsUriUsingTree/);
 assert.match(java,/java\.text\.Normalizer\.normalize/);
 assert.match(java,/equalsIgnoreCase\(wanted\)/);
 assert.match(java,/name=availableName\(name\)/);
 assert.match(java,/if\(targetExists\(singleName\)\)throw/);
 assert.match(java,/if\(targetExists\(publishName\)\)/);
 assert.match(java,/String suffix=" \(parziale\)"/);
 assert.match(java,/publishName=availableName\(/);
 assert.equal((java.match(/if\(targetExists\(/g)||[]).length,2);
});
test('Android keeps renamed document URI for rollback on final name verification error',()=>{
 const java=readFileSync(new URL('../android-bridge/BridgeDestinationPlugin.java.template',import.meta.url),'utf8');
 assert.match(java,/singleStaging=renamed;/);
 assert.match(java,/staging=renamed;/);
 assert.match(java,/deleteDocument\(\s*getContext\(\)\.getContentResolver\(\),singleStaging\)/);
 assert.match(java,/deleteDocument\(getContext\(\)\.getContentResolver\(\),staging\)/);
});


test('deep nested folder destination accepts protocol depth 32, rejects 33 before native writes',async()=>{
 const f=fakePlugin();
 const destination=createBridgeAndroidFolderDestination({plugin:f.plugin,name:'Folder'});
 await destination.begin();
 const depth32=Array.from({length:32},(_,i)=>'level'+i);
 await destination.makeDirectory(depth32);
 await assert.rejects(destination.makeDirectory([...depth32,'too-deep']),/invalid_path/);
 assert.equal(f.calls.filter(([name])=>name==='mkdir').length,1);
 assert.deepEqual(f.calls.find(([name])=>name==='mkdir')[1].path,depth32);
 const native=readFileSync(new URL('../android-bridge/BridgeDestinationPlugin.java.template',import.meta.url),'utf8');
 assert.match(native,/array\.length\(\)>32/);
 await destination.discard();
});

test('SAF provider metadata mismatch is accepted only after exact byte readback',()=>{
 const java=readFileSync(new URL('../android-bridge/BridgeDestinationPlugin.java.template',import.meta.url),'utf8');
 assert.match(java,/private boolean verifiedDocumentLength\(Uri uri,long expected\)/);
 assert.match(java,/if\(documentMatches\(uri,null,expected\)\)return true/);
 assert.match(java,/getContentResolver\(\)\.openInputStream\(uri\)/);
 assert.match(java,/if\(count>expected\)return false/);
 assert.match(java,/return count==expected/);
 assert.match(java,/file\.written!=file\.expected/);
 assert.match(java,/if\(!verifiedDocumentLength\(file\.uri,file\.expected\)\)/);
 assert.match(java,/if\(!verifiedDocumentLength\(renamed,files\.values\(\)\.iterator\(\)\.next\(\)\.expected\)\)/);
});


test('resumed folder skips a previously verified complete file, downloading only missing bytes',async()=>{
  const previous=FILE;
  const pending='66666666-6666-4666-8666-666666666666';
  const data=Buffer.from([1,2,3,4]);
  const calls=[],requests=[];
  const native={
    async beginFolder(args){calls.push(['begin',args]);return {started:true,resumed:true};},
    async makeDirectory(){},
    async openFile({path,size}){
      calls.push(['open',path.join('/')]);
      if(path[0]==='already.bin'){assert.equal(size,4);return {alreadyComplete:true};}
      return {fileId:previous};
    },
    async writeChunk(args){calls.push(['write',args.offset]);return {written:args.offset+Buffer.from(args.base64,'base64').length};},
    async commitFile(){calls.push(['commitFile']);},
    async discardFile(){calls.push(['discardFile']);},
    async commitFolder(){calls.push(['commitFolder']);return {name:'Album'};},
    async discardFolder(){calls.push(['discardFolder']);}
  };
  const destination=createBridgeAndroidFolderDestination({
    plugin:native,name:'Album',sourceKey:JSON.stringify([DEVICE,'Album'])
  });
  const api={
    async requestRead(deviceId,req){
      assert.equal(deviceId,DEVICE);requests.push(req);
      assert.equal(req.handle,pending);
      return {jobId:JOB,deviceId:DEVICE,state:'queued'};
    },
    async getStatus(){return {jobId:JOB,deviceId:DEVICE,state:'done'};},
    async getReadChunk(){return {base64:data.toString('base64'),bytesRead:4,eof:true};},
    async cancel(){}
  };
  const result=await downloadBridgeFolder({
    api,deviceId:DEVICE,destination,pause:async()=>{},
    listPage:async()=>({entries:[
      {handle:previous,name:'already.bin',directory:false,size:4,mime:'application/octet-stream'},
      {handle:pending,name:'missing.bin',directory:false,size:4,mime:'application/octet-stream'}
    ],nextOffset:-1})
  });
  assert.equal(result.files,2);
  assert.equal(requests.length,1);
  assert.deepEqual(calls.filter(x=>x[0]==='open').map(x=>x[1]),['already.bin','missing.bin']);
  assert.equal(calls.filter(x=>x[0]==='write').length,1);
  assert.equal(calls.filter(x=>x[0]==='commitFile').length,1);
  assert.ok(calls.some(x=>x[0]==='commitFolder'));
});

test('native resume is tied to source identity and SAF-owned document, not bare filenames',()=>{
 const java=readFileSync(new URL('../android-bridge/BridgeDestinationPlugin.java.template',import.meta.url),'utf8');
 assert.match(java,/MessageDigest\.getInstance\("SHA-256"\)/);
 assert.match(java,/DocumentsContract\.getDocumentId\(previous\.uri\)\.equals\(record\.getString\("document"\)\)/);
 assert.match(java,/DocumentsContract\.getDocumentId\(parent\(\)\)\.equals\(record\.optString\("parent"\)\)/);
 assert.match(java,/verifiedDocumentLength\(existing\.uri,size\)/);
 assert.match(java,/bridge_destination_resume_conflict/);
 assert.match(java,/if\(partial&&resumeKey!=null\)/);
 assert.match(java,/if\(resumeMode\)\{[\s\S]*?previously published partial folder/);
});
