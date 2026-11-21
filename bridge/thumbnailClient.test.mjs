import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canLoadBridgeThumbnail,fetchBridgeThumbnail,compactBridgeThumbnail,
  BRIDGE_AUTO_THUMB_MAX_BYTES
} from '../src/bridgeThumbnailClient.js';
const DEVICE='11111111-1111-4111-8111-111111111111';
const FILE='22222222-2222-4222-8222-222222222222';
const JOB='33333333-3333-4333-8333-333333333333';
const photo=(size,mime='image/jpeg')=>({
 handle:FILE,name:'IMG-001.jpg',size,mime,directory:false
});
function apiFor(bytes){
 let reads=0,cancels=0;
 const api={
  async requestRead(_device,{offset,length}){
   assert.equal(_device,DEVICE);
   assert.ok(offset>=0&&length>0&&length<=262144);
   reads++;
   return {jobId:JOB,deviceId:DEVICE,state:'queued'};
  },
  async getStatus(){return {jobId:JOB,deviceId:DEVICE,state:'done'};},
  async getReadChunk(){
   return {base64:Buffer.from(bytes).toString('base64'),bytesRead:bytes.length,eof:true};
  },
  async cancel(){cancels++;}
 };
 return {api,stats:()=>({reads,cancels})};
}

test('file rows are eligible for thumbnails only when they are image types',()=>{
 for(const mime of ['image/jpeg','image/png','image/webp','image/gif'])
  assert.equal(canLoadBridgeThumbnail(photo(4,mime)),true);
 assert.equal(canLoadBridgeThumbnail({...photo(4),directory:true}),false);
 assert.equal(canLoadBridgeThumbnail(photo(4,'application/pdf')),false);
 assert.equal(canLoadBridgeThumbnail(photo(0)),false);
});

test('visible small photo reads via existing authenticated Bridge read protocol',async()=>{
 const bytes=new Uint8Array([0xff,0xd8,0xff,0xd9]);
 const mock=apiFor(bytes);
 const result=await fetchBridgeThumbnail({
  api:mock.api,deviceId:DEVICE,item:photo(bytes.length),signal:new AbortController().signal
 });
 assert.equal(result.type,'image/jpeg');
 assert.deepEqual(new Uint8Array(await result.arrayBuffer()),bytes);
 assert.deepEqual(mock.stats(),{reads:1,cancels:0});
});

test('oversize non-JPEG photos are not fetched automatically',async()=>{
 let reads=0;
 const api={async requestRead(){reads++}};
 const result=await fetchBridgeThumbnail({
  api,deviceId:DEVICE,item:photo(BRIDGE_AUTO_THUMB_MAX_BYTES+1,'image/png')
 });
 assert.equal(result,null);
 assert.equal(reads,0);
});

test('large JPEG requests only bounded EXIF prefix, not a full photo',async()=>{
 const bytes=Buffer.alloc(65536);
 bytes[0]=0xff;bytes[1]=0xd8;
 const mock=apiFor(bytes);
 const result=await fetchBridgeThumbnail({
  api:mock.api,deviceId:DEVICE,item:photo(BRIDGE_AUTO_THUMB_MAX_BYTES+1)
 });
 assert.equal(result,null);
 assert.equal(mock.stats().reads,1);
});

test('thumbnail request rejects aborted signal without network activity',async()=>{
 let reads=0;
 const abort=new AbortController();abort.abort();
 await assert.rejects(fetchBridgeThumbnail({
  api:{async requestRead(){reads++}},deviceId:DEVICE,item:photo(12),signal:abort.signal
 }),/bridge_transfer_cancelled/);
 assert.equal(reads,0);
});

test('thumbnail compactor safely leaves Blob unchanged when no DOM is present',async()=>{
 const source=new Blob([new Uint8Array([1,2,3])],{type:'image/jpeg'});
 assert.equal(await compactBridgeThumbnail(source),source);
 await assert.rejects(()=>compactBridgeThumbnail(null),/invalid_blob/);
});


test('new TX generates a bounded JPEG thumbnail for a large HEIC photo without fetching original bytes',async()=>{
  const tiny=Uint8Array.from([0xff,0xd8,0xff,0xd9]);
  let native=0,full=0,readResult=0;
  const api={
    async requestThumbnail(deviceId,handle){
      assert.equal(deviceId,DEVICE);assert.equal(handle,FILE);native++;
      return {jobId:JOB,deviceId:DEVICE,state:'queued'};
    },
    async getStatus(jobId){
      assert.equal(jobId,JOB);return {jobId:JOB,deviceId:DEVICE,state:'done'};
    },
    async getThumbnail(jobId){
      assert.equal(jobId,JOB);readResult++;
      return {base64:Buffer.from(tiny).toString('base64'),bytesRead:tiny.length,eof:true};
    },
    async requestRead(){full++;throw Error('full_photo_fetch_forbidden');}
  };
  const result=await fetchBridgeThumbnail({api,deviceId:DEVICE,
    item:{...photo(12*1024*1024,'image/heic'),name:'IMG-001.heic'}});
  assert.equal(result.type,'image/jpeg');
  assert.deepEqual(new Uint8Array(await result.arrayBuffer()),tiny);
  assert.deepEqual({native,full,readResult},{native:1,full:0,readResult:1});
});

test('native thumbnail never accepts a mismatched device or invalid JPEG',async()=>{
  const basic={
    async requestThumbnail(){return {jobId:JOB,deviceId:DEVICE,state:'queued'};},
    async getStatus(){return {jobId:JOB,deviceId:DEVICE,state:'done'};},
    async getThumbnail(){return {base64:'AQIDBA==',bytesRead:4,eof:true};},
    async cancel(){return {state:'cancelled'};}
  };
  await assert.rejects(fetchBridgeThumbnail({api:basic,deviceId:DEVICE,item:photo(BRIDGE_AUTO_THUMB_MAX_BYTES+1)}),
    /bridge_thumbnail_invalid_jpeg/);
  const wrong={...basic,requestThumbnail:async()=>({
    jobId:JOB,deviceId:FILE,state:'queued'
  })};
  await assert.rejects(fetchBridgeThumbnail({api:wrong,deviceId:DEVICE,item:photo(BRIDGE_AUTO_THUMB_MAX_BYTES+1)}),
    /bridge_thumbnail_invalid_job/);
});

test('JPG smaller than 4MiB uses proven READ transport even when native thumbnail API exists',async()=>{
 const jpeg=Uint8Array.from([255,216,255,217]);
 let nativeRequests=0;
 const mock=apiFor(jpeg);
 const api={
   ...mock.api,
   async requestThumbnail(){nativeRequests++;throw Error('native_should_not_run');},
   async getThumbnail(){throw Error('native_should_not_run');}
 };
 const output=await fetchBridgeThumbnail({api,deviceId:DEVICE,item:photo(jpeg.length)});
 assert.equal(output.type,'image/jpeg');
 assert.equal(output.size,jpeg.length);
 assert.equal(mock.stats().reads,1);
 assert.equal(nativeRequests,0);
});
