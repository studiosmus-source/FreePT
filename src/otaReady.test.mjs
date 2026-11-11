import test from 'node:test';
import assert from 'node:assert/strict';
import {reportOtaReady} from './otaReady.js';
test('web does not call native updater',async()=>{
  let count=0;
  assert.equal(await reportOtaReady({notifyAppReady:()=>{count++;}},false),false);
  assert.equal(count,0);
});
test('native startup notifies the plugin',async()=>{
  let count=0;
  assert.equal(await reportOtaReady({notifyAppReady:async()=>{count++;}},true),true);
  assert.equal(count,1);
});
test('plugin failure never blocks chat/auth initialization',async()=>{
  assert.equal(await reportOtaReady({notifyAppReady:async()=>{throw Error('offline');}},true),false);
  assert.equal(await reportOtaReady({},true),false);
});
