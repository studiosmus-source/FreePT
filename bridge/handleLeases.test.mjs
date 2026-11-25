import test from 'node:test';
import assert from 'node:assert/strict';
import {withBridgeHandleLeases,BRIDGE_PAGE_LEASE_MS} from '../src/bridgeHandleLeases.js';

const DEVICE='11111111-1111-4111-8111-111111111111';
let seq=0;
const uuid=()=>{seq++;const h=seq.toString(16).padStart(12,'0');return `aaaaaaaa-aaaa-4aaa-8aaa-${h}`;};
const FOLDER='22222222-2222-4222-8222-222222222222';
const FILE='33333333-3333-4333-8333-333333333333';
const NESTED='44444444-4444-4444-8444-444444444444';

/** Simulates the server rule: a handle is readable only while the page that
 * published it is younger than 300 s. */
function fakeServer({clock}){
  const catalogue=new Map([
    ['root|0',[{handle:FOLDER,name:'DCIM',directory:true,size:-1,mime:'vnd.android.document/directory'}]],
    [FOLDER+'|0',[
      {handle:FILE,name:'a.jpg',directory:false,size:10,mime:'image/jpeg'},
      {handle:NESTED,name:'Sub',directory:true,size:-1,mime:'vnd.android.document/directory'}
    ]],
    [NESTED+'|0',[{handle:'55555555-5555-4555-8555-555555555555',name:'b.jpg',directory:false,size:5,mime:'image/jpeg'}]]
  ]);
  const authorized=new Map(); // handle -> expiry
  const jobs=new Map();
  const log=[];
  const api={
    async requestBrowse(deviceId,{handle,offset},opts){
      log.push(['browse',handle,offset,!!opts?.signal]);
      if(handle!=='root'&&!(authorized.get(handle)>clock.now))throw Error('bridge_backend_unavailable');
      const jobId=uuid();jobs.set(jobId,{handle,offset});
      return {jobId,deviceId,state:'queued'};
    },
    async getStatus(jobId){return {jobId,deviceId:DEVICE,state:'done'};},
    async getBrowsePage(jobId){
      const {handle,offset}=jobs.get(jobId);
      const entries=catalogue.get(handle+'|'+offset)||[];
      for(const entry of entries)authorized.set(entry.handle,clock.now+300000);
      return {jobId,entries,nextOffset:-1};
    },
    async requestRead(deviceId,{handle,offset,length},opts){
      log.push(['read',handle,offset,!!opts?.signal]);
      if(!(authorized.get(handle)>clock.now))throw Error('bridge_backend_unavailable');
      return {jobId:uuid(),deviceId,state:'queued'};
    },
    async getReadChunk(){return {}},
    async cancel(jobId){log.push(['cancel',jobId]);return {jobId,deviceId:DEVICE,state:'cancelled'};}
  };
  return {api,catalogue,log,authorized};
}
async function browse(api,handle,offset=0){
  const job=await api.requestBrowse(DEVICE,{handle,offset});
  return api.getBrowsePage(job.jobId);
}

test('fresh pages are used directly; no extra remote browse',async()=>{
  const clock={now:0};
  const s=fakeServer({clock});
  const api=withBridgeHandleLeases(s.api,{now:()=>clock.now,pause:async()=>{}});
  await browse(api,'root');await browse(api,FOLDER);
  s.log.length=0;
  clock.now+=60000;
  await api.requestRead(DEVICE,{handle:FILE,offset:0,length:10});
  assert.deepEqual(s.log.map(x=>x[0]),['read']);
});

test('stale page is re-listed through the normal browse job before reading',async()=>{
  const clock={now:0};
  const s=fakeServer({clock});
  const api=withBridgeHandleLeases(s.api,{now:()=>clock.now,pause:async()=>{}});
  await browse(api,'root');await browse(api,FOLDER);
  clock.now+=BRIDGE_PAGE_LEASE_MS+1000; // server lease still valid until 300 s
  s.log.length=0;
  await api.requestRead(DEVICE,{handle:FILE,offset:0,length:10});
  // Parent DCIM itself came from the (stale) root page: root renews first.
  assert.deepEqual(s.log.map(x=>x.slice(0,2)),[['browse','root'],['browse',FOLDER],['read',FILE]]);
});

test('after the server lease expired the read still succeeds (no 500 surfaced)',async()=>{
  const clock={now:0};
  const s=fakeServer({clock});
  const api=withBridgeHandleLeases(s.api,{now:()=>clock.now,pause:async()=>{}});
  await browse(api,'root');await browse(api,FOLDER);
  clock.now+=20*60000; // 20 minutes on the same folder
  const job=await api.requestRead(DEVICE,{handle:FILE,offset:0,length:10});
  assert.equal(job.state,'queued');
});

test('an unexpected 500 forces one renewal and one retry only',async()=>{
  const clock={now:0};
  const s=fakeServer({clock});
  const api=withBridgeHandleLeases(s.api,{now:()=>clock.now,pause:async()=>{}});
  await browse(api,'root');await browse(api,FOLDER);
  s.authorized.delete(FILE); // server forgot it although our lease looks fresh
  s.log.length=0;
  await api.requestRead(DEVICE,{handle:FILE,offset:0,length:10});
  assert.deepEqual(s.log.map(x=>x[0]),['read','browse','read']);
  // A permanent failure is not retried in a loop.
  s.api.requestRead=async()=>{throw Error('bridge_backend_unavailable');};
  await assert.rejects(api.requestRead(DEVICE,{handle:FILE,offset:0,length:10}),/bridge_backend_unavailable/);
});

test('remote restart: same name/size gets the new handle; changed item is reported',async()=>{
  const clock={now:0};
  const s=fakeServer({clock});
  const api=withBridgeHandleLeases(s.api,{now:()=>clock.now,pause:async()=>{}});
  await browse(api,'root');await browse(api,FOLDER);
  const NEW='66666666-6666-4666-8666-666666666666';
  s.catalogue.set(FOLDER+'|0',[{handle:NEW,name:'a.jpg',directory:false,size:10,mime:'image/jpeg'}]);
  clock.now+=BRIDGE_PAGE_LEASE_MS+1;
  s.log.length=0;
  await api.requestRead(DEVICE,{handle:FILE,offset:0,length:10});
  assert.deepEqual(s.log.at(-1).slice(0,2),['read',NEW]);
  // Size changed: never guess, report it.
  s.catalogue.set(FOLDER+'|0',[{handle:uuid(),name:'a.jpg',directory:false,size:11,mime:'image/jpeg'}]);
  clock.now+=BRIDGE_PAGE_LEASE_MS+1;
  await assert.rejects(api.requestRead(DEVICE,{handle:FILE,offset:0,length:10}),/bridge_remote_item_changed/);
});

test('enqueue is never aborted in flight; a late cancel removes the created job',async()=>{
  const clock={now:0};
  const s=fakeServer({clock});
  const api=withBridgeHandleLeases(s.api,{now:()=>clock.now,pause:async()=>{}});
  await browse(api,'root');await browse(api,FOLDER);
  const controller=new AbortController();
  const original=s.api.requestRead;
  s.api.requestRead=async(...args)=>{const r=await original(...args);controller.abort();return r;};
  s.log.length=0;
  await assert.rejects(api.requestRead(DEVICE,{handle:FILE,offset:0,length:10},{signal:controller.signal}),/bridge_transfer_cancelled/);
  assert.equal(s.log[0][3],false,'no abort signal reaches the enqueue HTTP request');
  assert.equal(s.log[1][0],'cancel');
});

test('sub-folder navigation after a long pause renews the parent chain',async()=>{
  const clock={now:0};
  const s=fakeServer({clock});
  const api=withBridgeHandleLeases(s.api,{now:()=>clock.now,pause:async()=>{}});
  await browse(api,'root');await browse(api,FOLDER);
  clock.now+=10*60000;
  s.log.length=0;
  await browse(api,NESTED);
  assert.deepEqual(s.log.map(x=>x[1]),['root',FOLDER,NESTED]);
});

test('without a usable api the wrapper is a no-op',()=>{
  assert.equal(withBridgeHandleLeases(null),null);
});
