import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/bridgeRemoteFilesUi.js',import.meta.url),'utf8');
test('remote preview is explicit and bounded',()=>{
  assert.match(source,/PREVIEW_LIMIT=2\*1024\*1024/);
  assert.match(source,/previewable\(item\)/);
  assert.match(source,/create\('button','Anteprima',options\)/);
  assert.match(source,/preview.onclick=\(\)=>\{menu.open=false;void showPreview\(item,deviceId\)\}/);
  assert.match(source,/item\.size<=PREVIEW_LIMIT/);
});
test('preview uses authorized chunk download and local blob URL',()=>{
  assert.match(source,/await downloadBridgeFile\(\{/);
  assert.match(source,/deviceId,handle:item\.handle,size:item\.size/);
  assert.match(source,/URL\.createObjectURL\(new Blob\(parts/);
  assert.match(source,/URL\.revokeObjectURL\(url\)/);
  assert.match(source,/setAttribute\('sandbox',''\)/);
});


test('remote browser uses paged user-triggered listing and releases active previews on navigation/dispose',()=>{
 assert.match(source,/more\.onclick=async\(\)=>/);
 assert.doesNotMatch(source,/await display\(page\.nextOffset\);\s*return;/);
 assert.match(source,/const previewClosers=new Set\(\)/);
 assert.match(source,/previewClosers\.add\(dismiss\)/);
 assert.match(source,/previewClosers\.delete\(dismiss\)/);
 assert.match(source,/controller\?\.abort\(\);\s*closePreviews\(\)/);
});
