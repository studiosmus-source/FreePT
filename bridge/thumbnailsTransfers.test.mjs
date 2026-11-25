import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchBridgeThumbnail,createBridgeThumbnailList,THUMBNAIL_FULL_READ_LIMIT} from '../src/bridgeThumbnailClient.js';
import {bridgeThumbnailKey,createBridgeThumbnailStore} from '../src/bridgeThumbnailStore.js';
import {createBridgeTransferManager,describeBridgeError} from '../src/bridgeTransferManager.js';

const DEVICE='11111111-1111-4111-8111-111111111111';
const HANDLE='22222222-2222-4222-8222-222222222222';
const JOB='33333333-3333-4333-8333-333333333333';
const tick=()=>new Promise(r=>setImmediate(r));

// Minimal JPEG with an EXIF APP1 segment holding an IFD1 JPEG thumbnail.
function jpegWithExifThumbnail(total){
  const thumb=Uint8Array.from([0xff,0xd8,0xff,0xd9]);
  const tiff=[0x49,0x49,0x2a,0x00,0x08,0x00,0x00,0x00,
    0x00,0x00, 0x1a,0x00,0x00,0x00, // IFD0: 0 entries, next IFD at 26
    0x02,0x00,
    0x01,0x02,0x04,0x00,0x01,0x00,0x00,0x00,0x38,0x00,0x00,0x00, // JPEGInterchangeFormat=56
    0x02,0x02,0x04,0x00,0x01,0x00,0x00,0x00,0x04,0x00,0x00,0x00, // length=4
    0x00,0x00,0x00,0x00];
  // pad TIFF so the thumbnail sits at offset 56
  const padded=[...tiff];
  padded.splice(10,0); // keep layout
  const body=new Uint8Array(56+thumb.length);
  body.set(tiff.slice(0,8),0);
  body.set([0x00,0x00,0x1a,0x00,0x00,0x00],8); // IFD0 count 0 + next=26 (bytes 8..13)
  body.set(tiff.slice(14),26);                 // IFD1 at 26
  body.set(thumb,56);
  const app1=new Uint8Array(2+6+body.length);
  app1[0]=(app1.length>>8)&255;app1[1]=app1.length&255;
  app1.set([69,120,105,102,0,0],2);app1.set(body,8);
  const out=new Uint8Array(total);
  out.set([0xff,0xd8,0xff,0xe1],0);out.set(app1,4);
  return out;
}
function readApi(bytes,log){
  return {
    async requestRead(_d,{offset,length}){log.push([offset,length]);this.last={offset,length};return {jobId:JOB,deviceId:DEVICE};},
    async getStatus(){return {jobId:JOB,deviceId:DEVICE,state:'done'};},
    async getReadChunk(){
      const {offset,length}=this.last;
      const slice=bytes.subarray(offset,offset+length);
      return {base64:Buffer.from(slice).toString('base64'),bytesRead:slice.length,eof:offset+length>=bytes.length};
    },
    async cancel(){}
  };
}

test('6 MB camera JPEG: one 64 KiB read gives the embedded thumbnail (was ~24 reads)',async()=>{
  const log=[];
  const bytes=jpegWithExifThumbnail(6*1024*1024);
  const blob=await fetchBridgeThumbnail({api:readApi(bytes,log),deviceId:DEVICE,
    item:{handle:HANDLE,name:'IMG.jpg',mime:'image/jpeg',size:bytes.length,directory:false}});
  assert.deepEqual(log,[[0,65536]]);
  assert.equal(blob.size,4);assert.equal(blob.type,'image/jpeg');
});

test('JPEG without EXIF over the small limit: no whole-file download',async()=>{
  const log=[];
  const bytes=new Uint8Array(THUMBNAIL_FULL_READ_LIMIT+1);bytes.set([0xff,0xd8,0xff,0xdb]);
  assert.equal(await fetchBridgeThumbnail({api:readApi(bytes,log),deviceId:DEVICE,
    item:{handle:HANDLE,name:'x.jpg',mime:'image/jpeg',size:bytes.length,directory:false}}),null);
  assert.equal(log.length,1);
});

test('small PNG is read whole; large PNG is skipped',async()=>{
  const log=[];
  const small=new Uint8Array(300*1024);
  const blob=await fetchBridgeThumbnail({api:readApi(small,log),deviceId:DEVICE,
    item:{handle:HANDLE,name:'s.png',mime:'image/png',size:small.length,directory:false}});
  assert.equal(blob.size,small.length);
  assert.deepEqual(log.map(x=>x[1]),[262144,307200-262144]);
  log.length=0;
  assert.equal(await fetchBridgeThumbnail({api:readApi(small,log),deviceId:DEVICE,
    item:{handle:HANDLE,name:'b.png',mime:'image/png',size:THUMBNAIL_FULL_READ_LIMIT+1,directory:false}}),null);
  assert.equal(log.length,0);
});

function fixture({load,store=null,permitted=()=>true,now=Date.now}){
  let callback;
  class Observer{constructor(cb){callback=cb;}observe(){}disconnect(){}}
  const queue=createBridgeThumbnailList({deviceId:DEVICE,api:{},canRun:permitted,load,
    compact:async b=>b,Observer,store,now,createUrl:()=>'blob:t',revokeUrl:()=>{},retryDelayMs:5});
  const row=(opts,handle=HANDLE)=>{
    const element={isConnected:true},img={hidden:true,removeAttribute(){delete this.src;}},icon={hidden:false};
    queue.track(element,{handle,name:'a.jpg',mime:'image/jpeg',size:10},img,icon,opts);
    return {element,img,icon};
  };
  return {queue,row,visible:r=>callback([{target:r.element,isIntersecting:true}])};
}

test('image fetched during a later folder page load is still shown (was left hidden)',async()=>{
  let busy=false;
  const f=fixture({load:async()=>new Blob(['x']),permitted:()=>!busy});
  const r=f.row();f.visible(r);f.queue.resume();await tick();await tick();
  assert.equal(r.img.src,'blob:t');
  busy=true;           // e.g. next page browse in progress
  r.img.onload();
  assert.equal(r.img.hidden,false);
  await f.queue.stop();
});

test('a transient failure gets one delayed retry, not an endless loop',async()=>{
  let calls=0;
  const f=fixture({load:async()=>{calls++;throw Error('bridge_download_timeout');}});
  const r=f.row();f.visible(r);f.queue.resume();
  await new Promise(res=>setTimeout(res,2300));
  assert.equal(calls,2);
  await f.queue.stop();
});

test('persistent store serves a thumbnail without any remote read',async()=>{
  let reads=0;
  const saved=new Map([['k1',new Blob(['cached'])]]);
  const store={async get(k){return saved.get(k)??null;},async put(k,b){saved.set(k,b);}};
  const f=fixture({load:async()=>{reads++;return new Blob(['net']);},store});
  const r=f.row({persistKey:Promise.resolve('k1')});f.visible(r);f.queue.resume();
  await tick();await tick();await tick();
  assert.equal(reads,0);assert.equal(r.img.src,'blob:t');
  const r2=f.row({persistKey:Promise.resolve('k2')},'44444444-4444-4444-8444-444444444444');f.visible(r2);
  await new Promise(res=>setTimeout(res,400));
  assert.equal(reads,1);assert.ok(saved.has('k2'));
  await f.queue.stop();
});

test('persistent key is an opaque hash: no file name stored',async()=>{
  const key=await bridgeThumbnailKey(['admin',DEVICE,'DCIM','Vacanze.jpg',10,'image/jpeg']);
  assert.match(key,/^[0-9a-f]{64}$/);
  assert.ok(!key.includes('Vacanze'));
  assert.notEqual(key,await bridgeThumbnailKey(['admin',DEVICE,'DCIM','Vacanze.jpg',11,'image/jpeg']));
  assert.equal(createBridgeThumbnailStore({indexedDB:null}),null);
});

function fakeDocument(){
  const make=tag=>({tag,children:[],hidden:false,textContent:'',isConnected:true,
    setAttribute(){},append(...c){this.children.push(...c);},remove(){this.isConnected=false;},onclick:null});
  return {body:make('body'),createElement:make};
}
test('transfer manager: survives panel disposal, one at a time, retry + cancel',async()=>{
  const doc=fakeDocument();
  const transfers=createBridgeTransferManager({doc,keepFinishedMs:1});
  let release;
  const first=transfers.start({label:'Cartella A',run:async({askRetry,status})=>{
    status('in corso');
    const again=await askRetry('Collegamento interrotto');
    await new Promise(r=>{release=r;});
    return again?'ripreso.':'no';
  }});
  assert.equal(transfers.active(),true);
  await assert.rejects(transfers.start({label:'B',run:async()=>{}}),/bridge_transfer_busy/);
  const banner=doc.body.children[0];
  const retry=banner.children[1].children[0];
  assert.equal(retry.hidden,false);retry.onclick();
  await tick();release();
  assert.match(await first,/ripreso/);
  assert.equal(transfers.active(),false);
  const cancelled=transfers.start({label:'C',run:({signal})=>new Promise((_,rej)=>
    signal.addEventListener('abort',()=>rej(Error('bridge_transfer_cancelled'))))});
  transfers.cancel();
  assert.equal(await cancelled,'Download interrotto.');
});

test('technical codes become readable Italian messages',()=>{
  assert.match(describeBridgeError(Error('bridge_backend_unavailable')),/Server Bridge/);
  assert.match(describeBridgeError(Error('bridge_xyz'),'Errore.'),/^Errore\. \(bridge_xyz\)$/);
  assert.equal(describeBridgeError(Error('Apri i file dalla chat.')),'Apri i file dalla chat.');
});
