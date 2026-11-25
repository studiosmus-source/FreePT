import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
test('admin no longer hands out codes',()=>{
  assert.doesNotMatch(main,/pcCodeAction|Codice per il PC|freept-pc-access/);
});
test('return requests: listed for the admin, approve/deny with confirmation, safe rendering',()=>{
  assert.match(main,/<div id="returnRequests" class="return-requests" hidden><\/div>/);
  assert.match(main,/db\.functions\.invoke\('freept-account-return',\{body:\{action:'list'\}\}\)/);
  assert.match(main,/db\.functions\.invoke\('freept-account-return',\{body:\{action,id:request\.id\}\}\)/);
  const block=main.slice(main.indexOf('function paintReturnRequests'),main.indexOf('async function loadReturnRequests'));
  assert.match(block,/confirm\(question\)/);
  assert.doesNotMatch(block,/innerHTML/);
  assert.match(main,/if\(profile\?\.role!=='admin'\|\|!adminUnlocked\)return;/);
});
