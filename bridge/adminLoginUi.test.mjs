import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const start=main.indexOf('function adminScreen(){');
const end=main.indexOf('\nfunction waitingScreen(){',start);
assert.ok(start>=0&&end>start,'adminScreen block must exist');
const admin=main.slice(start,end);

test('password login is primary while OTP is explicitly optional',()=>{
  assert.ok(admin.indexOf("'<form id=\"adminForm\"")>=0);
  assert.ok(admin.indexOf("'<details id=\"adminCodeOptions\"")>=0);
  assert.ok(admin.indexOf("'<form id=\"adminForm\"")<admin.indexOf("'<details id=\"adminCodeOptions\""));
  assert.match(admin,/signInWithPassword/);
  assert.match(admin,/completeAdminLogin\(result\.data\.user\)/);
  assert.match(admin,/Accesso con codice email \(solo se abilitato\)/);
});
test('OTP-disabled path clearly falls back to password and preserves session unlock',()=>{
  assert.match(admin,/status\(adminOtpFailureMessage\(error\),true\)/);
  assert.match(admin,/admin_code_delivery_failed:otp_disabled:/);
  assert.match(admin,/passwordForm\.querySelector/);
  assert.match(main,/if\(profile\.role==='admin' && !\(await unlockAdmin\(\)\)\)return;/);
  assert.match(main,/persistSession: true/);
});
