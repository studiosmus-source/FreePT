import test from 'node:test';
import assert from 'node:assert/strict';
import {isWindowsFreePT,normalizedWindowsEmail} from './windowsRegistration.js';
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
