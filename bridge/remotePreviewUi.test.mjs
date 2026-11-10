import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/bridgeRemoteFilesUi.js',import.meta.url),'utf8');
test('remote preview is explicit and bounded',()=>{
  assert.match(source,/PREVIEW_LIMIT=2\*1024\*1024/);
  assert.match(source,/previewable\(item\)/);
  assert.match(source,/create\('button','Anteprima',line\)/);
  assert.match(source,/item\.size<=PREVIEW_LIMIT/);
});
test('preview uses authorized chunk download and local blob URL',()=>{
  assert.match(source,/await downloadBridgeFile\(\{/);
  assert.match(source,/deviceId,handle:item\.handle,size:item\.size/);
  assert.match(source,/URL\.createObjectURL\(new Blob\(parts/);
  assert.match(source,/URL\.revokeObjectURL\(url\)/);
  assert.match(source,/setAttribute\('sandbox',''\)/);
});
