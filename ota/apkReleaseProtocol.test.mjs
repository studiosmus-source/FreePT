import test from 'node:test';
import assert from 'node:assert/strict';
import {validateApkRelease,chooseApkUpdate,noApkUpdateResponse} from './apkReleaseProtocol.mjs';

const GOOD_URL='https://github.com/studiosmus-source/FreePT/releases/download/apk-v1.2.0/FreePT.apk';
const SHA='a'.repeat(64);
const release={enabled:true,versionName:'1.2.0',versionCode:5,url:GOOD_URL,sha256:SHA,minSdkInt:26};
const device={platform:'android',app_id:'it.freept.app',device_id:'device-abc-123',version_code:4,version_name:'1.1.0',sdk_int:34};

test('disabled manifest yields null',()=>{
  assert.equal(validateApkRelease({enabled:false}),null);
  assert.equal(validateApkRelease(null),null);
});

test('valid manifest normalizes',()=>{
  const r=validateApkRelease({...release,sha256:SHA.toUpperCase()});
  assert.equal(r.versionCode,5);
  assert.equal(r.sha256,SHA); // lowercased
  assert.equal(r.minSdkInt,26);
});

test('manifest rejects bad url, checksum, extra keys, non-apk',()=>{
  for(const bad of [
    {...release,url:'https://evil.example/x.apk'},
    {...release,url:GOOD_URL.replace('.apk','.zip')},
    {...release,sha256:'xyz'},
    {...release,versionCode:0},
    {...release,minSdkInt:-1},
    {...release,versionName:'1.2'},
    {...release,extra:1}
  ]) assert.throws(()=>validateApkRelease(bad),/ota_apk_manifest_invalid/);
});

test('offers update when versionCode is higher and sdk compatible',()=>{
  const out=chooseApkUpdate(device,{stable:validateApkRelease(release)});
  assert.deepEqual(out,{versionName:'1.2.0',versionCode:5,url:GOOD_URL,sha256:SHA,minSdkInt:26});
});

test('no downgrade and no equal versionCode',()=>{
  assert.deepEqual(chooseApkUpdate({...device,version_code:5},{stable:validateApkRelease(release)}),noApkUpdateResponse());
  assert.deepEqual(chooseApkUpdate({...device,version_code:6},{stable:validateApkRelease(release)}),noApkUpdateResponse());
});

test('refuses when Android too old',()=>{
  assert.deepEqual(chooseApkUpdate({...device,sdk_int:25},{stable:validateApkRelease(release)}),noApkUpdateResponse());
});

test('wrong app or platform gets nothing',()=>{
  assert.deepEqual(chooseApkUpdate({...device,app_id:'it.other'},{stable:validateApkRelease(release)}),noApkUpdateResponse());
  assert.deepEqual(chooseApkUpdate({...device,platform:'ios'},{stable:validateApkRelease(release)}),noApkUpdateResponse());
});

test('version_code and sdk_int accepted as string or int',()=>{
  const r=validateApkRelease(release);
  assert.equal(chooseApkUpdate({...device,version_code:'4',sdk_int:'34'},{stable:r}).versionCode,5);
  assert.deepEqual(chooseApkUpdate({...device,version_code:'x'},{stable:r}),noApkUpdateResponse());
});

test('TEST device gets test release, others get stable',()=>{
  const stable=validateApkRelease(release);
  const testRel=validateApkRelease({...release,versionName:'1.3.0',versionCode:6,
    url:'https://github.com/studiosmus-source/FreePT/releases/download/apk-v1.3.0/FreePT.apk'});
  const ids=new Set(['tester-0001']);
  assert.equal(chooseApkUpdate({...device,device_id:'tester-0001'},{stable,test:testRel,testDeviceIds:ids}).versionCode,6);
  assert.equal(chooseApkUpdate({...device,device_id:'other-9999'},{stable,test:testRel,testDeviceIds:ids}).versionCode,5);
});

test('no stable release means no update even for unknown device',()=>{
  assert.deepEqual(chooseApkUpdate(device,{stable:null}),noApkUpdateResponse());
});
