import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const main=readFileSync(new URL('./main.js',import.meta.url),'utf8');
const legacy=readFileSync(new URL('./style.css',import.meta.url),'utf8');
const design=readFileSync(new URL('./designSystem.css',import.meta.url),'utf8');
const owner=readFileSync(new URL('./bridgeRemoteFilesUi.js',import.meta.url),'utf8');
const alert=readFileSync(new URL('./importantAlerts.js',import.meta.url),'utf8');
test('unified design imported after existing functional CSS',()=>{
  assert.match(main,/import '\.\/style\.css';\s*import '\.\/designSystem\.css';/);
  assert.match(design,/:root\{color-scheme:light/);
  assert.match(design,/\.shell\{/);
  assert.match(design,/\.top\{/);
});
test('admin and owner keep real functional controls and click handlers',()=>{
  for(const id of ['adminBridge','logout','people','chat','feed','send','sendBtn','freeptConversationNav','chatMessagesView','chatRemoteFilesView','importantAlertSend','ownerBridgeOpen']) {
    assert.ok(main.includes('id="'+id+'"')||main.includes('id=\\\"'+id+'\\\"'),id+' missing');
  }
  assert.match(main,/getElementById\('chatRemoteFilesView'\)\.onclick/);
  assert.match(main,/getElementById\('importantAlertSend'\)\.onclick/);
  assert.match(main,/getElementById\('ownerBridgeOpen'\)/);
  assert.match(main,/function showOwnerBridgeFolder\(\)/);
  assert.match(main,/function showAdminBridge\(\)/);
  assert.match(main,/renderBridgeRemoteFiles\(\{/);
  assert.match(main,/showImportantAlertComposer\(user\)/);
});
test('every journey gets design support without hiding functionality',()=>{
  for(const selector of ['.panel','.request-shell','.people','.person','.chat','.compose','.feed','#chatRemoteFilesPanel','.bridge-files-content','.bridge-family-panel','.bridge-admin-panel','.important-alert-composer','.important-alert-fullscreen','.freept-conversation-nav','.freept-owner-nav'])assert.ok(design.includes(selector),selector+' missing');
  assert.match(design,/grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.doesNotMatch(design,/#chatRemoteFilesPanel\s*\{[^}]*display:none/);
  assert.doesNotMatch(design,/#ownerBridgeOpen\s*\{[^}]*display:none/);
  assert.doesNotMatch(design,/#importantAlertSend\s*\{[^}]*display:none/);
  assert.match(legacy,/\.bridge-remote-entries>\.bridge-remote-folders/);
  assert.match(legacy,/\.bridge-file-preview-overlay\{/);
});
test('device browse requires authorization and transfer guard remains connected to actual host',()=>{
  assert.match(owner,/host\.dataset\.bridgeBusy=value\?'true':'false'/);
  assert.match(main,/querySelector\('#chatRemoteFilesPanel \.bridge-files-content'\)/);
  assert.match(main,/if\(guardBridgeNavigation\(\)\)return/);
  assert.match(main,/host:filesHost,db,bridgeClient/);
});
test('urgent message uses user text, and no read-confirmation is required',()=>{
  assert.match(alert,/const cleanBody=String\(body\)\.trim\(\)/);
  assert.match(alert,/close\.textContent='×'/);
  assert.doesNotMatch(alert,/textContent='Ho letto'/);
  assert.match(alert,/alert\.body/);
});
test('mobile layout has safe spacing and keyboard accessible controls',()=>{
  assert.match(design,/@media\(max-width:699px\)/);
  assert.match(design,/env\(safe-area-inset-bottom,0px\)/);
  assert.match(design,/:focus-visible/);
  assert.match(design,/@media\(prefers-reduced-motion:reduce\)/);
});
