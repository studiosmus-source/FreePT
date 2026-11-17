import test from 'node:test';
import assert from 'node:assert/strict';
import { BridgeDeviceCredentials } from './deviceCredentials.mjs';

test('separate devices have distinct credentials and cannot impersonate each other', () => {
  const credentials = new BridgeDeviceCredentials();
  const a = credentials.issue('tx-a');
  const b = credentials.issue('tx-b');
  assert.notEqual(a.secret, b.secret);
  assert.equal(a.secret.length, 64);
  assert.equal(credentials.authenticate('tx-a', a.secret), true);
  assert.equal(credentials.authenticate('tx-b', a.secret), false);
  assert.equal(credentials.authenticate('tx-a', b.secret), false);
});

test('rotation invalidates the old token while other devices continue working', () => {
  const credentials = new BridgeDeviceCredentials();
  const a = credentials.issue('tx-a');
  const b = credentials.issue('tx-b');
  const replacement = credentials.rotate('tx-a');
  assert.notEqual(a.secret, replacement.secret);
  assert.equal(credentials.authenticate('tx-a', a.secret), false);
  assert.equal(credentials.authenticate('tx-a', replacement.secret), true);
  assert.equal(credentials.authenticate('tx-b', b.secret), true);
});

test('revocation removes only the targeted device credential', () => {
  const credentials = new BridgeDeviceCredentials();
  const a = credentials.issue('tx-a');
  const b = credentials.issue('tx-b');
  assert.equal(credentials.revoke('tx-a'), true);
  assert.equal(credentials.authenticate('tx-a', a.secret), false);
  assert.equal(credentials.authenticate('tx-b', b.secret), true);
  assert.equal(credentials.revoke('tx-a'), false);
});

test('no duplicate enrollment and fail-closed malformed credentials', () => {
  const credentials = new BridgeDeviceCredentials();
  const issued = credentials.issue('tx');
  assert.throws(() => credentials.issue('tx'), /credential_exists/);
  assert.throws(() => credentials.rotate('missing'), /unknown_device/);
  assert.throws(() => credentials.issue(''), /invalid_device_id/);
  assert.equal(credentials.authenticate('tx', 'not-a-secret'), false);
  assert.equal(credentials.authenticate('unknown', issued.secret), false);
  assert.equal(credentials.authenticate('tx', issued.secret.toUpperCase()), false);
});

test('trusted verifier export excludes secret and can be restored', () => {
  const credentials = new BridgeDeviceCredentials();
  const issued = credentials.issue('tx');
  const verifier = credentials.exportVerifier('tx');
  assert.equal('secret' in verifier, false);
  assert.equal(JSON.stringify(verifier).includes(issued.secret), false);
  const restored = new BridgeDeviceCredentials();
  restored.importTrustedVerifier(verifier);
  assert.equal(restored.authenticate('tx', issued.secret), true);
  assert.throws(() => restored.importTrustedVerifier({ deviceId:'bad', salt:'1', verifier:'2' }), /invalid_device_verifier/);
});
