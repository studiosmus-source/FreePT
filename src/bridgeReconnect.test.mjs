import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('./main.js',import.meta.url),'utf8');

test('temporary server failures do not reopen device enrollment',()=>{
  const start=source.indexOf('if(!admin&&bridgeOwnerClient&&me?.id&&ownerSetupPromptedForAccount!==me.id)');
  const end=source.indexOf('if(admin){',start);
  assert.ok(start>=0&&end>start,'owner enrollment section must exist');
  const enrollment=source.slice(start,end);
  assert.match(enrollment,/catch\s*\{\s*\/\/ Connectivity or server errors do not revoke/);
  assert.match(enrollment,/catch\s*\{\s*\/\/ A temporary backend failure must not trigger/);
  assert.doesNotMatch(enrollment,/incomplete\s*=\s*!settings\.enabled\s*\|\|\s*!grants\.some\(g=>g\.active\)\s*\|\|\s*!service\?\.running/);
});

test('service recovery checks consent and respects explicit pause',()=>{
  const start=source.indexOf('async function startProvisionedTxWhenAllowed()');
  const end=source.indexOf('const el = document.getElementById',start);
  assert.ok(start>=0&&end>start);
  const recovery=source.slice(start,end);
  for(const required of ['state?.paused','state?.running','permission?.granted','device?.provisioned','setting?.enabled','grants.some(x=>x.active)'])
    assert.ok(recovery.includes(required),required);
});
