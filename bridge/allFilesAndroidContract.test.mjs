import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const java=readFileSync(new URL('../android-bridge/BridgeAllFilesCore.java.template',import.meta.url),'utf8');
const installer=readFileSync(new URL('../android-bridge/install.py',import.meta.url),'utf8');
test('isolated Android install registers all-files provider and permission',()=>{
  assert.match(installer,/registerPlugin\(BridgeAllFilesPlugin\.class\)/);
  assert.match(installer,/MANAGE_EXTERNAL_STORAGE/);
  assert.match(installer,/package != "it\.freept\.bridge"/);
  assert.match(installer,/BridgeAllFilesPlugin\.java\.template/);
});
test('remote TX uses wide storage only after OS permission granted',()=>{
  assert.match(main,/const all=await bridgeAllFiles\?\.status\(\)/);
  assert.match(main,/registerPlugin\('BridgeTxControl'\)/);
  assert.match(main,/bridgeTxControl\.start\(\)/);
  assert.match(main,/bridgeAllFiles\.requestPermission\(\)/);
  assert.match(java,/Environment\.isExternalStorageManager\(\)/);
  const permissionUi=readFileSync(new URL('../android-bridge/BridgeAllFilesPlugin.java.template',import.meta.url),'utf8');
  assert.match(permissionUi,/Settings\.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION/);
  assert.match(java,/getCanonicalPath\(\)/);
  assert.match(java,/\@PluginMethod public void readChunk/);
});
