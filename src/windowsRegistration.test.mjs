import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePcAccessCode,isWindowsFreePT,normalizedWindowsEmail} from './windowsRegistration.js';
test('Windows origin only; Android unaffected',()=>{
 globalThis.window={location:{hostname:'app.freept.test'}};
 assert.equal(isWindowsFreePT(),true);
 globalThis.window={location:{hostname:'other.example'}};
 assert.equal(isWindowsFreePT(),false);
 delete globalThis.window;
 assert.equal(isWindowsFreePT(),false);
});
test('Windows email trimmed and validated',()=>{
 assert.equal(normalizedWindowsEmail(' User@Example.IT '),'user@example.it');
 assert.throws(()=>normalizedWindowsEmail('bad'),/email valido/);
});

test('PC access code maps to the technical login of the same account',()=>{
  assert.deepEqual(parsePcAccessCode('K7Q2M9-48291376'),{email:'pc-k7q2m9@freept-pc.invalid',token:'48291376'});
  assert.deepEqual(parsePcAccessCode(' k7q2m9 4829 1376 '),{email:'pc-k7q2m9@freept-pc.invalid',token:'48291376'});
  for(const bad of ['','K7Q2M9','K7Q2M0-48291376','K7Q2M9-12','K7Q2M9-ABCDEFGH','../-12345678'])
    assert.throws(()=>parsePcAccessCode(bad));
});
