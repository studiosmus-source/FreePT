import test from 'node:test';
import assert from 'node:assert/strict';
import {receiveBridgeFile} from './chunkReceiver.mjs';

const block=(bytes,eof=false)=>({base64:Buffer.from(bytes).toString('base64'),bytesRead:bytes.length,eof});
const makeSink=()=>{
  const parts=[];let commits=0,discards=0;
  return {parts,write:async b=>parts.push(Buffer.from(b)),
    commit:async()=>{commits++},discard:async()=>{discards++},
    get commits(){return commits},get discards(){return discards}};
};
test('streams binary bytes in bounded chunks and commits',async()=>{
 const data=Buffer.from([0,255,42,1,2,127,128]);const sink=makeSink();let calls=0;
 const result=await receiveBridgeFile({size:data.length,chunkBytes:3,
  readChunk:async({offset,length})=>{calls++;return block(data.subarray(offset,offset+length),offset+length===data.length)},
  write:sink.write,commit:sink.commit,discard:sink.discard});
 assert.deepEqual(Buffer.concat(sink.parts),data);
 assert.equal(result.bytesReceived,7);assert.equal(calls,3);
 assert.equal(sink.commits,1);assert.equal(sink.discards,0);
});
test('read failure may safely reduce future chunk size without advancing offset',async()=>{
 const data=Buffer.alloc(14,27),sink=makeSink(),requests=[];
 let preferred=8,failOnce=true;
 await receiveBridgeFile({size:data.length,chunkBytes:8,
  chooseChunkBytes:()=>preferred,
  onReadError:(error,request)=>{
   if(error.message==='session_cancelled'&&request.offset===0){preferred=4;return true;}
   return false;
  },
  readChunk:async({offset,length})=>{
   requests.push([offset,length]);
   if(failOnce){failOnce=false;throw Error('session_cancelled');}
   return block(data.subarray(offset,offset+length),offset+length===data.length);
  },
  write:sink.write,commit:sink.commit,discard:sink.discard});
 assert.deepEqual(requests,[[0,8],[0,4],[4,4],[8,4],[12,2]]);
 assert.deepEqual(Buffer.concat(sink.parts),data);
 assert.equal(sink.commits,1);assert.equal(sink.discards,0);
});
test('rejects truncated data and discards partial output',async()=>{
 const sink=makeSink();
 await assert.rejects(receiveBridgeFile({size:8,readChunk:async()=>block(Buffer.from([1]),true),
  write:sink.write,commit:sink.commit,discard:sink.discard}),/truncated/);
 assert.equal(sink.commits,0);assert.equal(sink.discards,1);
});
test('rejects malformed base64 and discards',async()=>{
 const sink=makeSink();
 await assert.rejects(receiveBridgeFile({size:2,readChunk:async()=>({base64:'!!',bytesRead:2,eof:true}),
  write:sink.write,commit:sink.commit,discard:sink.discard}),/invalid/);
 assert.equal(sink.discards,1);
});
test('aborts without committing',async()=>{
 const sink=makeSink();const controller=new AbortController();
 await assert.rejects(receiveBridgeFile({size:4,chunkBytes:2,signal:controller.signal,
  readChunk:async({offset})=>block(Buffer.from([offset,offset+1])),
  write:async bytes=>{await sink.write(bytes);controller.abort()},
  commit:sink.commit,discard:sink.discard}),/cancelled/);
 assert.equal(sink.commits,0);assert.equal(sink.discards,1);
});
test('commits empty file without requesting a chunk',async()=>{
 const sink=makeSink();
 await receiveBridgeFile({size:0,readChunk:async()=>{throw Error('unexpected')},
  write:sink.write,commit:sink.commit,discard:sink.discard});
 assert.equal(sink.commits,1);assert.equal(sink.discards,0);
});
