import test from 'node:test';
import assert from 'node:assert/strict';
import {createIOSBridgeTxClient} from './iosBridgeTxClient.js';
const jobId='22222222-2222-4222-8222-222222222222';
const deviceId='11111111-1111-4111-8111-111111111111';
const handle='33333333-3333-4333-8333-333333333333';
function fixture(job){
  const actions=[];
  const files={
    async list(request){actions.push(['list',request]);return {
      entries:[{handle,name:'Downloads',directory:true,size:-1,mime:'vnd.android.document/directory'}],
      nextOffset:-1
    };},
    async read(request){actions.push(['read',request]);return {base64:'YQ==',bytesRead:1,eof:true};}
  };
  const device={
    async connect(){actions.push(['connect']);return {connected:true};},
    async poll(){actions.push(['poll']);return {job};},
    async respond(payload){actions.push(['respond',payload]);return {done:true};},
    async disconnect(){actions.push(['disconnect']);}
  };
  return {tx:createIOSBridgeTxClient({files,device}),actions};
}
test('no access before explicit start',async()=>{
  const f=fixture({jobId,deviceId,state:'sent',operation:'list'});
  assert.equal(await f.tx.step(),false);
  assert.deepEqual(f.actions,[]);
});
test('remote list uses only plugin-selected root and existing wire response',async()=>{
  const f=fixture({jobId,deviceId,state:'sent',operation:'list'});
  f.tx.start();
  assert.equal(await f.tx.step(),true);
  assert.deepEqual(f.actions.map(x=>x[0]),['connect','poll','list','respond']);
  assert.deepEqual(f.actions[2][1],{handle:'root',offset:0});
  assert.equal(f.actions[3][1].jobId,jobId);
});
test('remote read uses authorized opaque handle and requested bounds',async()=>{
  const f=fixture({jobId,deviceId,state:'sent',operation:'read',handle,offset:1,length:3});
  f.tx.start();
  assert.equal(await f.tx.step(),true);
  assert.deepEqual(f.actions[2][1],{handle,offset:1,length:3});
  assert.equal(f.actions[3][1].chunk.base64,'YQ==');
});
test('malformed remote handle never reads files',async()=>{
  const f=fixture({jobId,deviceId,state:'sent',operation:'read',handle:'../../secret',offset:0,length:3});
  f.tx.start();
  assert.equal(await f.tx.step(),false);
  assert.equal(f.actions.some(x=>x[0]==='read'),false);
});
test('foreground stop prevents further polling',async()=>{
  const f=fixture({jobId,deviceId,state:'sent',operation:'list'});
  f.tx.start();
  await f.tx.stop();
  assert.equal(await f.tx.step(),false);
  assert.deepEqual(f.actions.map(x=>x[0]),['disconnect']);
});
