import test from 'node:test';
import assert from 'node:assert/strict';
import {bridgePollRetry} from '../src/bridgePollRetry.js';

test('successful poll runs once', async () => {
  let calls=0;
  const r=await bridgePollRetry(async()=>{calls++;return {status:200};}, {pause:()=>{throw Error('unexpected pause');}});
  assert.equal(r.status,200);assert.equal(calls,1);
});
test('only 429 gets progressive retry delays',async()=>{
  let calls=0;const waits=[];
  const r=await bridgePollRetry(async()=>({status:++calls<3?429:200}),{pause:ms=>waits.push(ms)});
  assert.equal(r.status,200);assert.equal(calls,3);assert.deepEqual(waits,[1200,2400]);
});
test('persistent 429 bounded by max attempts',async()=>{
  let calls=0;
  const r=await bridgePollRetry(async()=>{calls++;return {status:429};},{pause:()=>{}});
  assert.equal(calls,4);assert.equal(r.status,429);
});
test('5xx cannot be retried after a possible job claim',async()=>{
  for(const status of [500,502,503,504]){
    let calls=0;
    const r=await bridgePollRetry(async()=>{calls++;return {status};},{pause:()=>{throw Error('unexpected retry');}});
    assert.equal(r.status,status);assert.equal(calls,1);
  }
});
test('transport failure cannot be retried after possible job claim',async()=>{
  let calls=0;
  await assert.rejects(bridgePollRetry(async()=>{calls++;throw new TypeError('network interrupted');},{pause:()=>{}}),TypeError);
  assert.equal(calls,1);
});
test('denied statuses never retried',async()=>{
  for(const status of [400,401,403,404,409]){
    let calls=0;
    const r=await bridgePollRetry(async()=>{calls++;return {status};},{pause:()=>{throw Error('unexpected retry');}});
    assert.equal(r.status,status);assert.equal(calls,1);
  }
});
test('programming errors are passed through',async()=>{
  await assert.rejects(bridgePollRetry(async()=>{throw Error('bug');}),/bug/);
});
test('invalid configuration rejected',async()=>{
  await assert.rejects(bridgePollRetry(null),/invalid_options/);
  await assert.rejects(bridgePollRetry(()=>{}, {maxAttempts:50}),/invalid_options/);
});
