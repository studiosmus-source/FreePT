import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../android-bridge/FreePTUpdaterPlugin.java.template',import.meta.url),'utf8');
test('endpoint is locked in native resources, not caller-supplied',()=>{
  assert.match(src,/getIdentifier\(\s*"ota_apk_endpoint"/);
  assert.match(src,/"\/apk-update"\.equals\(url\.getPath\(\)\)/);
});
test('only this repo GitHub .apk and sha256 are accepted',()=>{
  assert.match(src,/studiosmus-source\/FreePT\/releases\/download/);
  assert.match(src,/\[a-f0-9\]\{64\}/);
});
test('installs only after package, versionCode and signature checks',()=>{
  assert.match(src,/package_mismatch/);
  assert.match(src,/version_mismatch/);
  assert.match(src,/signature_mismatch/);
  assert.match(src,/checksum_mismatch/);
});
test('uses FileProvider and the system installer (mandatory Android confirmation)',()=>{
  assert.match(src,/FileProvider\.getUriForFile/);
  assert.match(src,/application\/vnd\.android\.package-archive/);
  assert.match(src,/canRequestPackageInstalls/);
});
test('no downgrade: target must exceed current versionCode',()=>{
  assert.match(src,/target<=selfVersionCode\(\)/);
});
