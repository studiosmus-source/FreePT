import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('./main.js',import.meta.url),'utf8');

test('opening an existing user workspace never re-prompts file access or Bridge activation',()=>{
  const start=source.indexOf('function renderLayout(){');
  const end=source.indexOf('function renderPeople(){',start);
  assert.ok(start>=0&&end>start);
  const layout=source.slice(start,end);
  assert.doesNotMatch(layout,/await showOwnerBridgeFolder\(\)/);
  assert.doesNotMatch(layout,/\.requestPermission\(\)/);
  assert.match(layout,/ownerOpen\.onclick=\(\)=>void showOwnerBridgeFolder\(\)/);
  assert.doesNotMatch(layout,/ownerSetupPromptedForAccount/);
});
test('file consent is still initiated explicitly by its owner',()=>{
  const start=source.indexOf('async function showOwnerBridgeFolder(){');
  const end=source.indexOf('function showImportantAlertComposer(',start);
  assert.ok(start>=0&&end>start);
  const ownerConsent=source.slice(start,end);
  assert.match(ownerConsent,/button\.onclick=async\(\)=>\{/);
  assert.match(ownerConsent,/bridgeAllFiles\.requestPermission\(\)/);
  assert.match(ownerConsent,/permission\?\.granted/);
});
test('service recovery checks consent and respects explicit pause',()=>{
  const start=source.indexOf('async function startProvisionedTxWhenAllowed()');
  const end=source.indexOf('const el = document.getElementById',start);
  assert.ok(start>=0&&end>start);
  const recovery=source.slice(start,end);
  for(const required of ['state?.paused','state?.running','permission?.granted','device?.provisioned','setting?.enabled','grants.some(x=>x.active)'])
    assert.ok(recovery.includes(required),required);
});
