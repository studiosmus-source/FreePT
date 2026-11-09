import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const start=src.indexOf('async function showOwnerBridgeFolder(){');const end=src.indexOf('function renderLayout(){',start);
assert.ok(start>=0&&end>start);const setup=src.slice(start,end);
test('diagnostics use only allowlisted stages and error codes',()=>{
  assert.match(setup,/allowedStages=new Set/);assert.match(setup,/allowedCodes=new Set/);
  assert.match(setup,/allowedCodes.has\(code\)\?code:'unknown'/);
  assert.match(setup,/console.info\('\[FreePT Bridge activation\]'/);
  assert.doesNotMatch(setup,/console\.(?:log|info|warn|error)\(error\)/);
  assert.doesNotMatch(setup,/JSON.stringify\(error\)/);
});
test('each activation phase records a diagnostic stage',()=>{
 for(const stage of ['permission','local-device','enrollment','family-grant','service-start','verification'])assert.ok(setup.includes("activationStage='"+stage+"'"));
 assert.match(setup,/diagnostic\('failure','permission_denied'\)/);
 assert.match(setup,/diagnostic\('failure',error instanceof Error\?error.message:'unknown'\)/);
});
test('family facing UI remains minimal',()=>{
 assert.match(setup,/>Attiva<\/button>/);assert.match(setup,/update\('Non è stato possibile attivare'\)/);
 assert.doesNotMatch(setup,/status\.textContent=error/);
});
