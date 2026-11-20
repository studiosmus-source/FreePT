import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/bridgeRemoteFilesUi.js',import.meta.url),'utf8');
test('remote preview is explicit and bounded',()=>{
  assert.match(source,/IMAGE_PREVIEW_LIMIT=8\*1024\*1024/);
  assert.match(source,/PDF_PREVIEW_LIMIT=2\*1024\*1024/);
  assert.match(source,/onProgress:p=>/);
  assert.match(source,/previewable\(item\)/);
  assert.match(source,/create\('button','Anteprima',options\)/);
  assert.match(source,/preview.onclick=\(\)=>\{menu.open=false;void showPreview\(item,deviceId\)\}/);
  assert.match(source,/item\.size<=IMAGE_PREVIEW_LIMIT/);
  assert.match(source,/item\.size<=PDF_PREVIEW_LIMIT/);
  assert.doesNotMatch(source,/createObjectURL\(new Blob\(parts[^)]*\)\).*for\s*\(/);
});
test('JPEG previews prefer bounded embedded EXIF thumbnail before any full download',()=>{
 assert.match(source,/readBridgePreviewPrefix\(\{/);
 assert.match(source,/extractEmbeddedJpegThumbnail\(prefix\)/);
 assert.match(source,/publishPreview\(new Blob\(\[thumbnail\],\{type:item\.mime\}\)\);return/);
 assert.match(source,/message\.textContent='Caricamento foto…'/);
});
test('preview uses authorized chunk download and local blob URL',()=>{
  assert.match(source,/await downloadBridgeFile\(\{/);
  assert.match(source,/deviceId,handle:item\.handle,size:item\.size/);
  assert.match(source,/URL\.createObjectURL\(blob\)/);
  assert.match(source,/publishPreview\(new Blob\(parts,\{type:item\.mime\}\)\)/);
  assert.match(source,/URL\.revokeObjectURL\(url\)/);
  assert.match(source,/setAttribute\('sandbox',''\)/);
});


test('preview opens fullscreen on document.body with an always-available X and safe cleanup',()=>{
 const styles=readFileSync(new URL('../src/style.css',import.meta.url),'utf8');
 assert.match(source,/create\('section',undefined,document\.body\)/);
 assert.match(source,/panel\.className='bridge-file-preview-overlay'/);
 assert.match(source,/panel\.setAttribute\('aria-modal','true'\)/);
 assert.match(source,/create\('button','×',header\)/);
 assert.match(source,/close\.className='bridge-file-preview-close'/);
 assert.match(source,/close\.onclick=dismiss/);
 assert.match(source,/event\.key==='Escape'/);
 assert.match(source,/URL\.revokeObjectURL\(url\)/);
 assert.match(source,/document\.removeEventListener\('keydown',onKeyDown\)/);
 assert.match(styles,/\.bridge-file-preview-overlay\{[\s\S]*?position:fixed;inset:0/);
 assert.match(styles,/height:100dvh/);
 assert.match(styles,/\.bridge-file-preview-media\{[\s\S]*?object-fit:contain/);
});
test('already opened previews are cached only in bounded session memory',()=>{
 assert.match(source,/PREVIEW_CACHE_BYTES=12\*1024\*1024/);
 assert.match(source,/cachedPreview\(key\)/);
 assert.match(source,/if\(cached\)\{publishPreview\(cached\);return;\}/);
 assert.match(source,/clearPreviewCache\(\)/);
 assert.match(source,/if\(closed\|\|abort\.signal\.aborted\)return/);
});
test('active file transfer prevents navigation away and defers chat polling',()=>{
 const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
 assert.match(source,/const setBridgeBusy=value=>/);
 assert.match(source,/setBridgeBusy\(true\)/);
 assert.match(source,/setBridgeBusy\(false\)/);
 assert.match(main,/function bridgeTransferActive\(\)/);
 assert.match(main,/function guardBridgeNavigation\(\)/);
 assert.match(main,/chatMessagesView'\)\.onclick=\(\)=>\{\s*if\(guardBridgeNavigation\(\)\)return/);
 assert.match(main,/chatRemoteFilesView'\)\.onclick=async\(\)=>\{\s*if\(guardBridgeNavigation\(\)\)return/);
 assert.match(main,/id='back'|getElementById\('back'\)/);
 assert.match(main,/fetchingMessages \|\| bridgeTransferActive\(\)/);
});
test('folder downloads show manifest progress instead of an indefinite preparation label',()=>{
 assert.match(source,/Scansione della cartella remota/);
 assert.match(source,/onScanProgress:p=>/);
 assert.match(source,/p\.foundEntries/);
 assert.match(source,/p\.pendingFolders/);
 assert.match(source,/setInterval\(\(\)=>\{/);
 assert.match(source,/clearInterval\(scanHeartbeat\)/);
 assert.match(source,/cachedFolderLister=async\(\{handle,offset,signal\}\)=>/);
 assert.match(source,/folderPages\.get\(key\)/);
 assert.match(source,/listPage:folderLister/);
});
test('browser names dot-hidden items and distinguishes partial lists from finished pages',()=>{
 const styles=readFileSync(new URL('../src/style.css',import.meta.url),'utf8');
 assert.match(source,/const hidden=item\.name\.startsWith\('\.'\)/);
 assert.match(source,/line\.dataset\.bridgeHidden=hidden\?'true':'false'/);
 assert.match(source,/create\('small','nascosto',line\)/);
 assert.match(source,/bridge-folder-completeness/);
 assert.match(source,/querySelectorAll\('\.bridge-entry\[data-bridge-hidden="true"\]'\)/);
 assert.match(source,/Elenco parziale: scorri per caricare le altre pagine/);
 assert.match(source,/Fine elenco trasmesso dal telefono/);
 assert.match(styles,/\.bridge-folder-completeness/);
});
test('remote browser preserves bounded paging, lazy loads on scroll, and cleans observers',()=>{
 assert.match(source,/more\.onclick=async\(\)=>/);
 assert.match(source,/moreObserver=new IntersectionObserver/);
 assert.match(source,/rootMargin:'0px 0px 180px 0px'/);
 assert.match(source,/stopObservingMore\(\)/);
 assert.match(source,/if\(more.disabled\|\|activeDownload\|\|!more.isConnected\|\|view!==navigation\)return/);
 assert.doesNotMatch(source,/await display\(page\.nextOffset\);\s*return;/);
 assert.match(source,/const previewClosers=new Set\(\)/);
 assert.match(source,/previewClosers\.add\(dismiss\)/);
 assert.match(source,/previewClosers\.delete\(dismiss\)/);
 assert.match(source,/controller\?\.abort\(\);\s*abortActiveBrowse\(\);\s*stopObservingMore\(\);\s*closePreviews\(\)/);
 assert.match(source,/signal:currentBrowse\.signal/);
 assert.match(source,/pendingBrowse\?\.abort\(\)/);
});
