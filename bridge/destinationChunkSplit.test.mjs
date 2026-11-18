import test from 'node:test';
import assert from 'node:assert/strict';
import {createBridgeAndroidSingleFileWriter,encodeBridgeBytes} from '../src/bridgeAndroidDestination.js';

function fakePlugin(){
  const writes=[];let pos=0;
  const plugin={
    async beginSingleFile(){return {fileId:'0a1b2c3d-1111-2222-3333-444455556666'};},
    async writeChunk({fileId,offset,base64}){
      const bytes=Buffer.from(base64,'base64');
      assert.equal(offset,pos,'writes must be sequential and offset-correct');
      writes.push(bytes.length);pos+=bytes.length;
      return {written:pos};
    },
    async commitFile(){},async commitSingleFile(){},async discardSingleFile(){}
  };
  return {plugin,writes,get total(){return pos;}};
}

test('a 256 KiB network chunk is written in a single 256 KiB SAF call',async()=>{
  const f=fakePlugin();
  const w=await createBridgeAndroidSingleFileWriter({plugin:f.plugin,name:'x.bin',size:262144,mime:'application/octet-stream'});
  const chunk=new Uint8Array(262144).map((_,i)=>i%256);
  await w.write(chunk,0);
  await w.commit();
  assert.equal(f.total,262144);
  assert.ok(f.writes.every(n=>n<=262144),'every SAF write <= 262144');
  assert.equal(f.writes.reduce((a,b)=>a+b,0),262144);
  assert.equal(f.writes.length,1);
});

test('encodeBridgeBytes refuses chunks over 256 KiB',()=>{
  assert.throws(()=>encodeBridgeBytes(new Uint8Array(262145)),/bridge_destination_invalid_chunk/);
});

test('second 256 KiB chunk continues at the right absolute offset',async()=>{
  const f=fakePlugin();
  const w=await createBridgeAndroidSingleFileWriter({plugin:f.plugin,name:'x.bin',size:524288,mime:'application/octet-stream'});
  await w.write(new Uint8Array(262144),0);
  await w.write(new Uint8Array(262144),262144);
  await w.commit();
  assert.equal(f.total,524288);assert.equal(f.writes.length,2);
});
