import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const wf=readFileSync(new URL('../.github/workflows/bridge-android-staging.yml',import.meta.url),'utf8');
test('CI never uploads an APK without fixed signing identity',()=>{
  for(const key of ['FREEPT_BRIDGE_KEYSTORE_B64','FREEPT_BRIDGE_STORE_PASSWORD','FREEPT_BRIDGE_KEY_ALIAS','FREEPT_BRIDGE_KEY_PASSWORD','FREEPT_BRIDGE_CERT_SHA256'])
    assert.ok(wf.includes('secrets.'+key),key);
  assert.match(wf,/Missing stable Bridge signing secret/);
  assert.match(wf,/verify --verbose --print-certs/);
  assert.match(wf,/Bridge signing identity mismatch/);
  assert.match(wf,/path: android\/app\/build\/outputs\/apk\/debug\/bridge-stable\.apk/);
  assert.doesNotMatch(wf,/path: android\/app\/build\/outputs\/apk\/debug\/app-debug\.apk/);
  assert.match(wf,/EXPECTED_ID=it\.freept\.bridge/);
});
