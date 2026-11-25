import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/bridgeRemoteFilesUi.js',import.meta.url),'utf8');
test('remote preview is explicit and bounded',()=>{
  const policy=readFileSync(new URL('../src/bridgePreviewPolicy.js',import.meta.url),'utf8');
  assert.match(policy,/IMAGE_PREVIEW_LIMIT=8\*1024\*1024/);
  assert.match(policy,/PDF_PREVIEW_LIMIT=2\*1024\*1024/);
  assert.match(source,/onProgress:p=>/);
  assert.match(source,/previewable\(item\)/);
  assert.match(source,/create\('button','Anteprima',options\)/);
  assert.match(source,/preview.onclick=\(\)=>\{menu.open=false;void showPreview\(item,deviceId\)\}/);
  assert.match(source,/position\+bytes.length>policy.limit/);
  assert.match(source,/bridgePreviewPolicy\(item\)/);
  assert.doesNotMatch(source,/createObjectURL\(new Blob\(parts[^)]*\)\).*for\s*\(/);
});
test('large JPEG previews use only bounded EXIF, small images avoid a redundant prefix read',()=>{
 assert.match(source,/policy.mime==='image\/jpeg'&&policy.embeddedOnly/);
 assert.match(source,/readBridgePreviewPrefix\(\{/);
 assert.match(source,/extractEmbeddedJpegThumbnail\(prefix\)/);
 assert.match(source,/await publishPreview\(new Blob\(\[thumbnail\],\{type:policy\.mime\}\)\);return/);
 assert.match(source,/message\.textContent='Caricamento foto…'/);
});
test('preview uses authorized chunk download and local blob URL',()=>{
  assert.match(source,/await downloadBridgeFile\(\{/);
  assert.match(source,/deviceId,handle:item\.handle,size:item\.size/);
  assert.match(source,/URL\.createObjectURL\(blob\)/);
  assert.match(source,/await publishPreview\(new Blob\(parts,\{type:policy\.mime\}\)\)/);
  assert.match(source,/URL\.revokeObjectURL\(url\)/);
  assert.doesNotMatch(source,/'iframe'|innerHTML|fetch\(/);
  assert.match(source,/create\('pre',text,content\)/);
  assert.match(source,/bridgeDestination.renderPdfPreview\(\{base64,page\}\)/);
  assert.match(source,/view.onerror=/);
  assert.match(source,/Scarica file originale/);
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
 assert.match(source,/if\(cached\)\{await publishPreview\(cached\);return;\}/);
 assert.match(source,/clearPreviewCache\(\)/);
 assert.match(source,/if\(closed\|\|abort\.signal\.aborted\|\|!alive\(\)\)return/);
});
test('active file transfer prevents navigation away and defers chat polling',()=>{
 const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
 assert.match(source,/const setBridgeBusy=value=>/);
 assert.match(source,/setBridgeBusy\(true\)/);
 assert.match(source,/setBridgeBusy\(false\)/);
 assert.match(main,/function bridgeTransferActive\(\)/);
 assert.match(main,/function guardBridgeNavigation\(\)/);
 assert.match(main,/const showChatMessages=\(\)=>\{\s*if\(guardBridgeNavigation\(\)\)return/);
 assert.match(main,/openChatRemoteFiles=async\(\)=>\{\s*if\(guardBridgeNavigation\(\)\)return/);
 assert.match(main,/nav\.onclick=showChatMessages/);
 assert.match(main,/id="openFilesAction"/);
 assert.match(main,/id="chatRemoteFilesView"/);
 assert.match(main,/id="chatMessagesView"/);
 assert.match(main,/id="importantAlertSend"/);
 assert.match(main,/id="ownerBridgeOpen"/);
 assert.match(main,/querySelector\('#chatRemoteFilesPanel \.bridge-files-content'\)/);
 assert.match(main,/id='back'|getElementById\('back'\)/);
 assert.match(main,/fetchingMessages \|\| bridgeTransferActive\(\)/);
});
test('folder inventory is independently counted before user approval and destination writes',()=>{
 const css=readFileSync(new URL('../src/style.css',import.meta.url),'utf8');
 assert.match(source,/await inspectBridgeFolder\(\{/);
 assert.match(source,/reviewFolderInventory\(\{/);
 assert.match(source,/summary\.files\+' file/);
 assert.match(source,/summary\.hidden/);
 assert.match(source,/inventoryItems\[shown\+\+\]/);
 assert.match(source,/bridge-folder-inventory-scroll/);
 assert.match(source,/const approved=await reviewFolderInventory/);
 assert.match(source,/if\(!approved\)/);
 assert.match(source,/await destinationReady\(\)/);
 assert.match(source,/manifest,/);
 assert.match(source,/preserveCompletedOnCancel:true/);
 assert.doesNotMatch(source,/cachedFolderLister=async/);
 assert.match(css,/\.bridge-folder-inventory-scroll/);
});
test('folder cancellation reports preserved complete files',()=>{
 assert.match(source,/result\.partial/);
 assert.match(source,/Conservati '\+result\.files/);
 assert.match(source,/result\.savedName/);
 assert.match(source,/clearInterval\(heartbeat\)/);
 assert.match(source,/Conteggio: '\+p\.foundFiles/);
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
test('repeated File tab and rapid Refresh do not create duplicate root jobs',()=>{
 const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
 assert.match(main,/panel\.dataset\.bridgeOwnerId===user\.id&&typeof chatFilesCleanup==='function'/);
 assert.match(source,/if\(!alive\(\)\|\|listingDevices\)return/);
 assert.match(source,/refresh\.disabled=true/);
 assert.match(source,/finally\{listingDevices=false;refresh\.disabled=false;\}/);
 assert.match(source,/if\(openingDeviceId===deviceId\)return/);
 assert.match(source,/finally\{if\(openingDeviceId===deviceId\)openingDeviceId=null;\}/);
});
test('folders display before files across paginated pages, without new browsing requests',()=>{
 const styles=readFileSync(new URL('../src/style.css',import.meta.url),'utf8');
 assert.match(source,/create\('h4','Cartelle',list\)/);
 assert.match(source,/create\('h4','File',list\)/);
 assert.match(source,/className='bridge-remote-folders'/);
 assert.match(source,/className='bridge-remote-files'/);
 assert.match(source,/const target=item\.directory\?folders:files/);
 assert.match(source,/const line=create\('div',undefined,target\)/);
 assert.match(source,/target\.previousElementSibling\.hidden=false/);
 assert.match(source,/inventoryItems=\[\.\.\.manifest\]\.sort\(/);
 assert.match(source,/Number\(b\.directory\)-Number\(a\.directory\)/);
 assert.match(styles,/\.bridge-list-section-heading\[hidden\]\{display:none\}/);
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
 assert.match(source,/controller\?\.abort\(\);\s*abortActiveBrowse\(\);\s*void thumbnailList\?\.stop\(\);\s*stopObservingMore\(\);\s*closePreviews\(\)/);
 assert.match(source,/signal:currentBrowse\.signal/);
 assert.match(source,/pendingBrowse\?\.abort\(\)/);
});

test('folder and file rows are single-column across grouped folders (not flex-wrapped cards)',()=>{
 const styles=readFileSync(new URL('../src/style.css',import.meta.url),'utf8');
 const legacy=styles.lastIndexOf('.bridge-remote-entries>div{display:flex;');
 const fixed=styles.lastIndexOf('/* Remote file browser: columns are GROUPS');
 assert.ok(legacy>=0&&fixed>legacy,'directory row override must follow legacy layout');
 const override=styles.slice(fixed);
 assert.match(override,/\.bridge-remote-entries>\.bridge-remote-folders/);
 assert.match(override,/\.bridge-remote-entries>\.bridge-remote-files/);
 assert.match(override,/display:block;box-sizing:border-box;width:100%/);
 assert.match(override,/\.bridge-remote-folders>\.bridge-entry/);
 assert.match(override,/\.bridge-remote-files>\.bridge-entry/);
 assert.match(override,/display:flex;align-items:center;flex-wrap:nowrap/);
});
test('remote directory loading reports queued/sent states without infinite spinners',()=>{
 assert.match(source,/onProgress:progress=>\{/);
 assert.match(source,/progress\.state==='queued'/);
 assert.match(source,/progress\.elapsedSeconds/);
 assert.match(source,/bridge_remote_browse_timeout/);
 assert.match(source,/Premi Aggiorna per riprovare/);
});

test('chat, files, urgent alerts and owner file authorisation remain visible',()=>{
 const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
 const css=readFileSync(new URL('../src/style.css',import.meta.url),'utf8');
 for(const feature of ['freeptConversationNav','chatMessagesView','chatRemoteFilesView','importantAlertSend','ownerBridgeOpen']){
  assert.match(main,new RegExp('id="'+feature+'"'),feature);
 }
 assert.match(main,/showImportantAlertComposer\(user\)/);
 assert.match(main,/showOwnerBridgeFolder\(\)/);
 assert.match(css,/\.freept-conversation-nav\{display:grid/);
 assert.match(css,/grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
 assert.match(main,/host:filesHost,db,bridgeClient/);
 assert.match(main,/bridgeTransferActive\(\)/);
});
