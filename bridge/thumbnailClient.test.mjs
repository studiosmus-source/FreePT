import test from 'node:test';
import assert from 'node:assert/strict';
import {canLoadBridgeThumbnail,fetchBridgeThumbnail,createBridgeThumbnailList} from '../src/bridgeThumbnailClient.js';
const DEVICE='11111111-1111-4111-8111-111111111111';
const HANDLE='22222222-2222-4222-8222-222222222222';
const JOB='33333333-3333-4333-8333-333333333333';
const image={handle:HANDLE,name:'foto.JPG',mime:'application/octet-stream',size:4,directory:false};
const tick=()=>new Promise(r=>setImmediate(r));
test('generic Android MIME still creates list thumbnails for photographs',()=>{
  assert.equal(canLoadBridgeThumbnail(image),true);
  assert.equal(canLoadBridgeThumbnail({...image,directory:true}),false);
  assert.equal(canLoadBridgeThumbnail({...image,name:'a.zip'}),false);
});
test('list thumbnail uses unchanged authorized read protocol',async()=>{
  let reads=0;
  const api={
    async requestRead(device,{handle,offset,length}){
      assert.equal(device,DEVICE);assert.equal(handle,HANDLE);
      assert.equal(offset,0);assert.equal(length,4);reads++;
      return {jobId:JOB,deviceId:DEVICE};
    },
    async getStatus(){return {jobId:JOB,deviceId:DEVICE,state:'done'};},
    async getReadChunk(){return {base64:'/9j/2Q==',bytesRead:4,eof:true};},
    async cancel(){}
  };
  const blob=await fetchBridgeThumbnail({api,deviceId:DEVICE,item:image});
  assert.equal(reads,1);assert.equal(blob.type,'image/jpeg');assert.equal(blob.size,4);
});
test('large JPEG without EXIF reads only 64 KiB and large PNG does not auto-download',async()=>{
  let reads=0;
  const api={
    async requestRead(_device,{length}){reads++;assert.equal(length,65536);return {jobId:JOB,deviceId:DEVICE};},
    async getStatus(){return {jobId:JOB,deviceId:DEVICE,state:'done'};},
    async getReadChunk(){return {base64:Buffer.alloc(65536).toString('base64'),bytesRead:65536,eof:false};},
    async cancel(){}
  };
  assert.equal(await fetchBridgeThumbnail({api,deviceId:DEVICE,item:{...image,size:9*1024*1024}}),null);
  assert.equal(await fetchBridgeThumbnail({api,deviceId:DEVICE,item:{...image,mime:'image/png',size:9*1024*1024}}),null);
  assert.equal(reads,1);
});
function fixture(load){
  let callback;
  class Observer{
    constructor(cb){callback=cb;}
    observe(){}
    disconnect(){}
  }
  const revoked=[];
  let permitted=true;
  const queue=createBridgeThumbnailList({
    deviceId:DEVICE,api:{},canRun:()=>permitted,load,compact:async b=>b,Observer,
    createUrl:()=> 'blob:test',revokeUrl:u=>revoked.push(u)
  });
  const row=()=>{
    const element={isConnected:true},img={hidden:true,removeAttribute(){delete this.src;}},icon={hidden:false};
    queue.track(element,image,img,icon);
    return {element,img,icon};
  };
  return {queue,row,revoked,visible:(r,on=true)=>callback([{target:r.element,isIntersecting:on}]),
    permit:v=>{permitted=v;}};
}
test('only visible rows read bytes and display a real image instead of the file icon',async()=>{
  let reads=0;
  const f=fixture(async()=>{reads++;return new Blob(['image']);});
  const first=f.row(),offscreen=f.row();
  f.queue.resume();await tick();assert.equal(reads,0);
  f.visible(first);await tick();assert.equal(reads,1);
  assert.equal(first.img.src,'blob:test');
  first.img.onload();assert.equal(first.img.hidden,false);assert.equal(first.icon.hidden,true);
  assert.equal(offscreen.img.src,undefined);
  await f.queue.stop();assert.deepEqual(f.revoked,['blob:test']);
});
test('navigation pauses and drains the one active request before further work',async()=>{
  let concurrent=0,max=0;
  const f=fixture(({signal})=>new Promise((resolve,reject)=>{
    concurrent++;max=Math.max(max,concurrent);
    signal.addEventListener('abort',()=>{concurrent--;reject(Error('cancelled'));},{once:true});
  }));
  const first=f.row(),second=f.row();
  f.visible(first);f.visible(second);f.queue.resume();await tick();
  assert.equal(concurrent,1);
  await f.queue.pause();assert.equal(concurrent,0);assert.equal(max,1);
  await f.queue.stop();
});
test('leaving viewport revokes URLs; cached re-entry does not reread remote bytes',async()=>{
  let reads=0;
  const f=fixture(async()=>{reads++;return new Blob(['image']);});
  const row=f.row();f.visible(row);f.queue.resume();await tick();
  f.visible(row,false);assert.deepEqual(f.revoked,['blob:test']);
  await f.queue.pause();f.visible(row);f.queue.resume();await tick();
  assert.equal(reads,1);
  await f.queue.stop();
});
test('authorization loss prevents thumbnail publication and new work',async()=>{
  let finish;
  const f=fixture(()=>new Promise(r=>{finish=r;}));
  const row=f.row();f.visible(row);f.queue.resume();await tick();
  f.permit(false);finish(new Blob(['image']));await tick();
  assert.equal(row.img.src,undefined);
  await f.queue.stop();
});
