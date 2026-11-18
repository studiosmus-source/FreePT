import test from 'node:test';
import assert from 'node:assert/strict';
import {parseVersion,isNewer,validateRelease,chooseUpdate,parseTestDeviceIds,noUpdateResponse} from './releaseProtocol.mjs';

const sample=(version='0.1.1')=>({
  enabled:true,version,nativeVersionCode:1,
  url:'https://github.com/studiosmus-source/FreePT/releases/download/ota-0.1.1/FreePT-web.zip',
  checksum:'a'.repeat(64)
});
const info=(changes={})=>({
  app_id:'it.freept.app',platform:'android',version_code:'1',
  version_name:'builtin',device_id:'device-123456',...changes
});
test('manifest is disabled by default',()=>assert.equal(validateRelease({enabled:false}),null));
test('versions are strict semver and increase monotonically',()=>{
  assert.deepEqual(parseVersion('1.2.3'),[1,2,3]);
  assert.equal(parseVersion('01.2.3'),null);
  assert.equal(isNewer('1.2.0','1.1.99'),true);
  assert.equal(isNewer('1.2.0','1.2.0'),false);
  assert.equal(isNewer('0.1.1','builtin'),true);
  assert.equal(isNewer('0.1.1','unknown'),false);
});
test('reject untrusted ZIP URL and wrong checksum',()=>{
  assert.throws(()=>validateRelease({...sample(),url:'https://other-site.example/b.zip'}),/invalid/);
  assert.throws(()=>validateRelease({...sample(),checksum:'1234'}),/invalid/);
  assert.throws(()=>validateRelease({...sample(),nativeVersionCode:0}),/invalid/);
  assert.throws(()=>validateRelease({...sample(),extra:true}),/invalid/);
});
test('stable is default, TEST only to server allowlisted device',()=>{
  const stable=validateRelease(sample('0.1.1'));
  const beta=validateRelease(sample('0.1.2'));
  const options={stable,test:beta,testDeviceIds:new Set(['device-123456'])};
  assert.equal(chooseUpdate(info(),options).version,'0.1.2');
  assert.equal(chooseUpdate(info({device_id:'device-999999'}),options).version,'0.1.1');
});
test('native build mismatches and invalid app identifiers fail closed',()=>{
  const release=validateRelease(sample());
  assert.deepEqual(chooseUpdate(info({version_code:'2'}),{stable:release}),noUpdateResponse());
  assert.deepEqual(chooseUpdate(info({app_id:'it.bad.app'}),{stable:release}),noUpdateResponse());
  assert.deepEqual(chooseUpdate(info({platform:'ios'}),{stable:release}),noUpdateResponse());
  assert.deepEqual(chooseUpdate(info({version_name:'0.2.0'}),{stable:release}),noUpdateResponse());
});
test('unknown clients never get offered a ZIP',()=>{
  const stable=validateRelease(sample());
  assert.deepEqual(chooseUpdate(null,{stable}),noUpdateResponse());
  assert.deepEqual(chooseUpdate(info({device_id:''}),{stable}),noUpdateResponse());
  assert.deepEqual(chooseUpdate(info({version_name:'x'}),{stable}),noUpdateResponse());
});
test('TEST allowlist rejects malformed entries and caps size',()=>{
  assert.deepEqual([...parseTestDeviceIds('device-123456,device-abcdef')],['device-123456','device-abcdef']);
  assert.throws(()=>parseTestDeviceIds('../../private'),/invalid/);
  assert.throws(()=>parseTestDeviceIds(Array(32).fill('device-abcdef').join(',')),/invalid/);
});
