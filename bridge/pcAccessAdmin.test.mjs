import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
test('PC access code: admin-only menu action, server-issued, validated, never persisted',()=>{
  assert.match(main,/user\.status==='approved'&&user\.role!=='admin'\?'<button type="button" id="pcCodeAction">Codice per il PC<\/button>'/);
  assert.match(main,/db\.functions\.invoke\('freept-pc-access',\{body:\{userId:user\.id\}\}\)/);
  assert.match(main,/\/\^\[A-Z0-9\]\{6\}-\[0-9\]\{6,10\}\$\/\.test\(code\)/);
  assert.match(main,/value\.textContent=code/);
  const block=main.slice(main.indexOf("const pcAction="),main.indexOf("const run=async deleteUser"));
  assert.doesNotMatch(block,/localStorage|sessionStorage|innerHTML/);
  assert.match(block,/confirm\(/);
});
