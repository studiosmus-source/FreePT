import test from 'node:test';
import assert from 'node:assert/strict';
import {createOriginalTxRx} from '../src/originalTxRx.js';
const rx='r'.repeat(40),tx='t'.repeat(40);
const id='12345678-1234-4234-8234-123456789abc';
test('rejects missing or equal keys',async()=>{
  const client=createOriginalTxRx({request:async()=>({status:200,data:{requests:[]}})});
  await assert.rejects(client.connect('short',tx),/invalid_credentials/);
  await assert.rejects(client.connect(rx,rx),/invalid_credentials/);
});
test('credentials used only as auth header, never URL',async()=>{
  let seen;
  const client=createOriginalTxRx({request:async o=>{seen=o;return {status:200,data:{requests:[]}};}});
  await client.connect(rx,tx);
  assert.equal(seen.url,'https://tx-3dhs.onrender.com/v1/pair/pending');
  assert.equal(seen.headers.Authorization,'Bearer '+rx);
  assert.ok(!JSON.stringify(seen).includes(tx));
  client.disconnect();
  await assert.rejects(client.pending(),/not_authenticated/);
});
test('bad auth clears secrets',async()=>{
  const client=createOriginalTxRx({request:async()=>({status:401,data:{}})});
  await assert.rejects(client.connect(rx,tx),/auth_denied/);
  assert.equal(client.connected(),false);
});
test('legacy list uses existing relay job protocol',async()=>{
  const seen=[];
  const client=createOriginalTxRx({request:async o=>{
    seen.push(o);
    if(o.url.endsWith('/pair/pending'))return {status:200,data:{requests:[]}};
    if(o.url.endsWith('/v1/rx/request'))return {status:202,data:{id}};
    return {status:200,data:{ok:true,entries:[{path:'DCIM',name:'DCIM',directory:true}],hasMore:false}};
  }});
  await client.connect(rx,tx);
  const data=await client.list('',0);
  assert.equal(data.entries[0].name,'DCIM');
  assert.equal(seen[1].data.op,'list');
});
test('no access without credentials',async()=>{
  const client=createOriginalTxRx({request:async()=>{throw Error('should not send');}});
  await assert.rejects(client.list(),/not_authenticated/);
});
