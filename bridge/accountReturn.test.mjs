import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
test('reinstalled phone: duplicate number asks to return to the same account',()=>{
  assert.match(main,/e\?\.code==='23505'\|\|\/profiles_phone_key\|duplicate key\/i\.test\(message\)/);
  assert.match(main,/db\.functions\.invoke\('freept-account-return',\s*\{body:\{action:'request',phone,name\}\}\)/);
  assert.match(main,/localStorage\.setItem\(RETURN_FLAG,'1'\)/);
});
test('waiting screen is the standard one and polls only while shown',()=>{
  const block=main.slice(main.indexOf('function returnWaitingScreen'),main.indexOf('async function loadProfile'));
  assert.match(block,/waitingScreen\(\);/);
  assert.match(block,/action:'status'/);
  assert.match(block,/db\.auth\.verifyOtp\(\{email:data\.email,token:data\.token,type:'email'\}\)/);
  assert.match(block,/if\(document\.querySelector\('\.waiting-copy'\)\)returnTimer=setTimeout\(check,8000\)/);
  assert.match(block,/requestScreen\(true\)/);
});
test('no user-facing reference to a person in the return flow',()=>{
  const block=main.slice(main.indexOf('function returnWaitingScreen'),main.indexOf('async function loadProfile'));
  assert.doesNotMatch(block,/amministrat|admin/i);
});
