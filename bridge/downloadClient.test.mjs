import test from 'node:test';
import assert from 'node:assert/strict';
import {downloadBridgeFile} from '../src/bridgeDownloadClient.js';
const DEVICE='11111111-1111-4111-8111-111111111111';
const HANDLE='22222222-2222-4222-8222-222222222222';
const JOB='33333333-3333-4333-8333-333333333333';
function fixture(data,states=['queued','done']){
 const chunks=[],requests=[];let discarded=0,committed=0,checks=0;
 const api={
  async requestRead(deviceId,request){assert.equal(deviceId,DEVICE);requests.push(request);return {jobId:JOB,deviceId:DEVICE,state:'queued'}},
  async getStatus(){return {jobId:JOB,deviceId:DEVICE,state:states[Math.min(checks++,states.length-1)]}},
  async getReadChunk(){const last=requests.at(-1);const bytes=data.subarray(last.offset,last.offset+last.length);
   return {base64:bytes.toString('base64'),bytesRead:bytes.length,eof:last.offset+bytes.length===data.length}},
  async cancel(){return {jobId:JOB,deviceId:DEVICE,state:'cancelled'}}
 };
 const destination={write:async b=>chunks.push(Buffer.from(b)),commit:async()=>{committed++},discard:async()=>{discarded++}};
 return {api,destination,chunks,requests,get committed(){return committed},get discarded(){return discarded}};
}
test('downloads entire binary file automatically with repeated read jobs',async()=>{
 const data=Buffer.alloc(600000);for(let i=0;i<data.length;i++)data[i]=i%256;
 const f=fixture(data);
 const result=await downloadBridgeFile({api:f.api,deviceId:DEVICE,handle:HANDLE,
  size:data.length,destination:f.destination,pause:async()=>{}});
 assert.equal(result.bytesReceived,data.length);
 assert.deepEqual(Buffer.concat(f.chunks),data);
 // Conservative network jobs avoid 256 KiB TX session failures in real transfers.
 const expectedRequests=[];
 for(let offset=0;offset<data.length;offset+=65536)
  expectedRequests.push({handle:HANDLE,offset,length:Math.min(65536,data.length-offset)});
 assert.deepEqual(f.requests,expectedRequests);
 assert.equal(f.committed,1);assert.equal(f.discarded,0);
});
test('recovers one cancelled TX job by re-reading the same range once',async()=>{
 const data=Buffer.from([4,5,6,7,8]);
 const f=fixture(data,['cancelled','done']);
 const result=await downloadBridgeFile({api:f.api,deviceId:DEVICE,handle:HANDLE,
  size:data.length,destination:f.destination,pause:async()=>{}});
 assert.equal(result.bytesReceived,data.length);
 assert.deepEqual(f.requests.map(r=>[r.offset,r.length]),[[0,5],[0,5]]);
 assert.deepEqual(Buffer.concat(f.chunks),data);
 assert.equal(f.committed,1);assert.equal(f.discarded,0);
});
test('repeated TX cancellations fail closed and discard the staged file',async()=>{
 const f=fixture(Buffer.from([4,5,6]),['cancelled']);
 await assert.rejects(downloadBridgeFile({api:f.api,deviceId:DEVICE,handle:HANDLE,
  size:3,destination:f.destination,pause:async()=>{}}),/bridge_download_job_cancelled/);
 assert.equal(f.requests.length,3);
 assert.equal(f.committed,0);assert.equal(f.discarded,1);
});
test('times out without committing partial bytes',async()=>{
 const f=fixture(Buffer.from([1,2,3]),['queued']);
 await assert.rejects(downloadBridgeFile({api:f.api,deviceId:DEVICE,handle:HANDLE,size:3,
  destination:f.destination,maxPolls:2,pause:async()=>{}}),/timeout/);
 assert.equal(f.committed,0);assert.equal(f.discarded,1);
});
test('rejects mismatched job and cleans destination',async()=>{
 const f=fixture(Buffer.from([1,2,3]));
 f.api.getStatus=async()=>({jobId:HANDLE,deviceId:DEVICE,state:'done'});
 await assert.rejects(downloadBridgeFile({api:f.api,deviceId:DEVICE,handle:HANDLE,
  size:3,destination:f.destination}),/mismatch/);
 assert.equal(f.discarded,1);
});
test('handles empty file without allocating a read job',async()=>{
 const f=fixture(Buffer.alloc(0));
 await downloadBridgeFile({api:f.api,deviceId:DEVICE,handle:HANDLE,size:0,destination:f.destination});
 assert.equal(f.requests.length,0);assert.equal(f.committed,1);
});
test('cancellation discards staged output',async()=>{
 const f=fixture(Buffer.alloc(3));
 const ctl=new AbortController();
 f.api.getStatus=async()=>{ctl.abort();return {jobId:JOB,deviceId:DEVICE,state:'queued'}};
 await assert.rejects(downloadBridgeFile({api:f.api,deviceId:DEVICE,handle:HANDLE,size:3,
  destination:f.destination,signal:ctl.signal,pause:async()=>{}}),/cancelled/);
 assert.equal(f.discarded,1);assert.equal(f.committed,0);
});
