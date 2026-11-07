import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const entry = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const start = entry.indexOf('async function unlockAdmin(){');
const end = entry.indexOf('\nconst esc =', start);
assert.ok(start >= 0 && end > start, 'FreePT unlockAdmin implementation must be present');
const source = entry.slice(start, end);

function harness({ native, biometricAvailable = false } = {}) {
  const calls = [];
  const context = {
    adminUnlocked: false,
    adminUnlocking: false,
    Capacitor: { isNativePlatform: () => native },
    NativeBiometric: {
      isAvailable: async () => { calls.push('availability'); return { isAvailable: biometricAvailable }; },
      verifyIdentity: async () => { calls.push('verify'); }
    },
    el: { innerHTML: '' },
    heading: () => '',
    document: { getElementById: () => ({ onclick: null }) },
    status: () => {},
    friendly: e => e.message,
    renderWorkspace: async () => {}
  };
  runInNewContext(source + '\nthis.invokeUnlock = unlockAdmin;', context);
  return { context, calls };
}

test('browser admin unlock records granted state for protected UI actions', async () => {
  const { context, calls } = harness({ native: false });
  assert.equal(await context.invokeUnlock(), true);
  assert.equal(context.adminUnlocked, true);
  assert.deepEqual(calls, []);
});

test('native admin lock never bypasses biometrics when unavailable', async () => {
  const { context, calls } = harness({ native: true, biometricAvailable: false });
  assert.equal(await context.invokeUnlock(), false);
  assert.equal(context.adminUnlocked, false);
  assert.deepEqual(calls, ['availability']);
});

test('native admin lock opens only after biometric verification', async () => {
  const { context, calls } = harness({ native: true, biometricAvailable: true });
  assert.equal(await context.invokeUnlock(), true);
  assert.equal(context.adminUnlocked, true);
  assert.deepEqual(calls, ['availability', 'verify']);
});
