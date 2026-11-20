import test from 'node:test';
import assert from 'node:assert/strict';
import {extractEmbeddedJpegThumbnail} from '../src/bridgeExifThumbnail.js';
import {readBridgePreviewPrefix} from '../src/bridgeDownloadClient.js';

function jpegWithExifThumbnail(thumb=Uint8Array.from([0xff,0xd8,0xff,0xd9])){
 const tiff=new Uint8Array(44+thumb.length),v=new DataView(tiff.buffer);
 tiff[0]=73;tiff[1]=73;v.setUint16(2,42,true);v.setUint32(4,8,true);
 v.setUint16(8,0,true);v.setUint32(10,14,true);
 v.setUint16(14,2,true);
 v.setUint16(16,0x201,true);v.setUint16(18,4,true);v.setUint32(20,1,true);v.setUint32(24,44,true);
 v.setUint16(28,0x202,true);v.setUint16(30,4,true);v.setUint32(32,1,true);v.setUint32(36,thumb.length,true);
 v.setUint32(40,0,true);tiff.set(thumb,44);
 const payload=Uint8Array.from([69,120,105,102,0,0,...tiff]);
 const length=payload.length+2;
 return Uint8Array.from([0xff,0xd8,0xff,0xe1,length>>8,length&255,...payload,0xff,0xda]);
}
test('extracts real JPEG SOI/EOI bytes from bounded EXIF IFD1 segment',()=>{
 const file=jpegWithExifThumbnail();
 assert.deepEqual(extractEmbeddedJpegThumbnail(file),Uint8Array.from([255,216,255,217]));
});
test('rejects malformed EXIF offsets, corrupt JPEG, and truncated prefix',()=>{
 const file=jpegWithExifThumbnail();
 assert.equal(extractEmbeddedJpegThumbnail(new Uint8Array(file.subarray(0,22))),null);
 const corrupt=file.slice();corrupt[39]=255; // bad IFD1 entry type / offsets
 assert.equal(extractEmbeddedJpegThumbnail(corrupt),null);
 assert.equal(extractEmbeddedJpegThumbnail(Uint8Array.from([1,2,3])),null);
});
test('reads exactly 64 KiB authenticated prefix and never requests full photo',async()=>{
 const size=4*1024*1024,bytes=Buffer.alloc(65536,42),requests=[];
 const deviceId='11111111-1111-4111-8111-111111111111';
 const handle='22222222-2222-4222-8222-222222222222';
 const jobId='33333333-3333-4333-8333-333333333333';
 let polls=0;
 const api={
  async requestRead(id,range){assert.equal(id,deviceId);requests.push(range);return{jobId,deviceId,state:'queued'};},
  async getStatus(){polls++;return{jobId,deviceId,state:polls<2?'queued':'done'};},
  async getReadChunk(){return{base64:bytes.toString('base64'),bytesRead:bytes.length,eof:false};},
  async cancel(){throw Error('unexpected_cancel');}
 };
 const out=await readBridgePreviewPrefix({api,deviceId,handle,size,pause:async()=>{}});
 assert.deepEqual(out,new Uint8Array(bytes));
 assert.deepEqual(requests,[{handle,offset:0,length:65536}]);
});
test('preview prefix cancels pending job when request is aborted',async()=>{
 const deviceId='11111111-1111-4111-8111-111111111111';
 const handle='22222222-2222-4222-8222-222222222222';
 const jobId='33333333-3333-4333-8333-333333333333';
 const signal=new AbortController();let cancelled=false;
 const api={
  async requestRead(){return{jobId,deviceId,state:'queued'};},
  async getStatus(){signal.abort();return{jobId,deviceId,state:'queued'};},
  async getReadChunk(){throw Error('not allowed');},
  async cancel(id){assert.equal(id,jobId);cancelled=true;}
 };
 await assert.rejects(readBridgePreviewPrefix({
  api,deviceId,handle,size:100000,signal:signal.signal,pause:async()=>{}
 }),/cancelled/);
 assert.equal(cancelled,true);
});
