import test from 'node:test';
import assert from 'node:assert/strict';
import { BridgeRegistry } from './deviceRouting.mjs';

function paired() {
  const r = new BridgeRegistry();
  r.registerDevice({ id: 'tx-a', ownerId: 'owner-a', label: 'Telefono A' });
  r.registerDevice({ id: 'tx-b', ownerId: 'owner-b', label: 'Telefono B' });
  r.setBridgeEnabled({ deviceId: 'tx-a', ownerId: 'owner-a', enabled: true });
  r.setBridgeEnabled({ deviceId: 'tx-b', ownerId: 'owner-b', enabled: true });
  r.setOnline('tx-a', true);
  r.setOnline('tx-b', true);
  r.grant({ deviceId: 'tx-a', receiverId: 'rx-1', approvedByOwnerId: 'owner-a' });
  r.grant({ deviceId: 'tx-b', receiverId: 'rx-1', approvedByOwnerId: 'owner-b' });
  return r;
}

test('two simultaneous TX never consume the other TX job', () => {
  const r = paired();
  r.enqueue({ jobId: 'a1', deviceId: 'tx-a', receiverId: 'rx-1', operation: 'list' });
  r.enqueue({ jobId: 'b1', deviceId: 'tx-b', receiverId: 'rx-1', operation: 'list' });
  assert.equal(r.takeNext('tx-b').jobId, 'b1');
  assert.equal(r.takeNext('tx-a').jobId, 'a1');
  assert.equal(r.takeNext('tx-b'), null);
});

test('unauthorized RX cannot queue or retrieve another RX jobs', () => {
  const r = paired();
  assert.throws(() => r.enqueue({ jobId: 'j1', deviceId: 'tx-a', receiverId: 'rx-2', operation: 'list' }), /not_authorized/);
  r.enqueue({ jobId: 'j2', deviceId: 'tx-a', receiverId: 'rx-1', operation: 'list' });
  r.takeNext('tx-a');
  assert.throws(() => r.complete({ jobId: 'j2', deviceId: 'tx-a', receiverId: 'rx-2' }), /not_authorized/);
  assert.throws(() => r.complete({ jobId: 'j2', deviceId: 'tx-b', receiverId: 'rx-1' }), /not_authorized/);
  assert.equal(r.complete({ jobId: 'j2', deviceId: 'tx-a', receiverId: 'rx-1' }).state, 'done');
});

test('revocation cancels outstanding work and hides device', () => {
  const r = paired();
  r.enqueue({ jobId: 'j', deviceId: 'tx-a', receiverId: 'rx-1', operation: 'list' });
  assert.throws(() => r.revoke({ deviceId: 'tx-a', receiverId: 'rx-1', approvedByOwnerId: 'owner-b' }), /owner_required/);
  r.revoke({ deviceId: 'tx-a', receiverId: 'rx-1', approvedByOwnerId: 'owner-a' });
  assert.deepEqual(r.listApproved('rx-1').map(x => x.id), ['tx-b']);
  assert.equal(r.takeNext('tx-a'), null);
  assert.throws(() => r.enqueue({ jobId: 'j2', deviceId: 'tx-a', receiverId: 'rx-1', operation: 'list' }), /not_authorized/);
});

test('offline and missing approvals fail closed', () => {
  const r = new BridgeRegistry();
  r.registerDevice({ id: 'tx', ownerId: 'owner', label: 'Tel' });
  assert.throws(() => r.grant({ deviceId: 'tx', receiverId: 'rx', approvedByOwnerId: 'stranger' }), /approval_required/);
  assert.throws(() => r.enqueue({ jobId: 'j', deviceId: 'tx', receiverId: 'rx', operation: 'list' }), /device_offline/);
  r.setBridgeEnabled({ deviceId: 'tx', ownerId: 'owner', enabled: true });
  r.setOnline('tx', true);
  assert.throws(() => r.enqueue({ jobId: 'j', deviceId: 'tx', receiverId: 'rx', operation: 'list' }), /not_authorized/);
});

test('offline TX does not accept queued jobs and cannot complete an in-flight request', () => {
  const r = paired();
  r.enqueue({ jobId: 'queued', deviceId: 'tx-a', receiverId: 'rx-1', operation: 'list' });
  r.setOnline('tx-a', false);
  assert.equal(r.takeNext('tx-a'), null);
  r.setOnline('tx-a', true);
  assert.equal(r.takeNext('tx-a').jobId, 'queued');
  r.setOnline('tx-a', false);
  assert.throws(() => r.complete({ jobId: 'queued', deviceId: 'tx-a', receiverId: 'rx-1' }), /not_authorized/);
});

test('revocation prevents completion of a command already dispatched', () => {
  const r = paired();
  r.enqueue({ jobId: 'sent', deviceId: 'tx-a', receiverId: 'rx-1', operation: 'list' });
  assert.equal(r.takeNext('tx-a').jobId, 'sent');
  r.revoke({ deviceId: 'tx-a', receiverId: 'rx-1', approvedByOwnerId: 'owner-a' });
  assert.throws(() => r.complete({ jobId: 'sent', deviceId: 'tx-a', receiverId: 'rx-1' }), /not_authorized/);
  assert.equal(r.listApproved('rx-1').some(x => x.id === 'tx-a'), false);
});

test('punctuation in IDs cannot reuse authorization for another device', () => {
  const r = new BridgeRegistry();
  r.registerDevice({ id: 'a:b', ownerId: 'owner-1', label: 'Telefono 1' });
  r.registerDevice({ id: 'a', ownerId: 'owner-2', label: 'Telefono 2' });
  r.setBridgeEnabled({ deviceId: 'a:b', ownerId: 'owner-1', enabled: true });
  r.setBridgeEnabled({ deviceId: 'a', ownerId: 'owner-2', enabled: true });
  r.setOnline('a:b', true);
  r.setOnline('a', true);
  r.grant({ deviceId: 'a:b', receiverId: 'c', approvedByOwnerId: 'owner-1' });
  assert.deepEqual(r.listApproved('c').map(x => x.id), ['a:b']);
  assert.deepEqual(r.listApproved('b:c').map(x => x.id), []);
  assert.throws(() => r.enqueue({
    jobId: 'bad', deviceId: 'a', receiverId: 'b:c', operation: 'list'
  }), /not_authorized/);
});

test('durable grants survive restart but online presence and queued jobs do not', () => {
  const original = paired();
  original.enqueue({ jobId: 'pending', deviceId: 'tx-a', receiverId: 'rx-1', operation: 'list' });
  const persisted = JSON.parse(JSON.stringify(original.snapshot()));
  const rebooted = BridgeRegistry.fromTrustedSnapshot(persisted);
  assert.deepEqual(rebooted.listApproved('rx-1').map(x => x.id), ['tx-a', 'tx-b']);
  assert.deepEqual(rebooted.listApproved('rx-1').map(x => x.online), [false, false]);
  assert.equal(rebooted.takeNext('tx-a'), null);
  rebooted.setOnline('tx-a', true);
  assert.equal(rebooted.takeNext('tx-a'), null);
  assert.throws(() => rebooted.enqueue({
    jobId: 'fresh', deviceId: 'tx-a', receiverId: 'rx-2', operation: 'list'
  }), /not_authorized/);
});

test('revoked grants are absent from saved state', () => {
  const r = paired();
  r.revoke({ deviceId: 'tx-a', receiverId: 'rx-1', approvedByOwnerId: 'owner-a' });
  const restored = BridgeRegistry.fromTrustedSnapshot(r.snapshot());
  assert.deepEqual(restored.listApproved('rx-1').map(x => x.id), ['tx-b']);
});

test('invalid persisted schema and orphan grants fail closed', () => {
  assert.throws(() => BridgeRegistry.fromTrustedSnapshot({ version: 2, devices: [], grants: [] }), /invalid_snapshot/);
  assert.throws(() => BridgeRegistry.fromTrustedSnapshot({
    version: 1, devices: [], grants: [{ deviceId: 'missing', receiverId: 'rx' }]
  }), /invalid_snapshot/);
});

test('owner can disable Bridge without confusing network loss with closure', () => {
  const r = paired();
  r.enqueue({ jobId: 'pending', deviceId: 'tx-a', receiverId: 'rx-1', operation: 'list' });
  r.setOnline('tx-a', false);
  r.setOnline('tx-a', true);
  assert.equal(r.takeNext('tx-a').jobId, 'pending');
  r.enqueue({ jobId: 'cancel', deviceId: 'tx-a', receiverId: 'rx-1', operation: 'list' });
  assert.throws(() => r.setBridgeEnabled({ deviceId: 'tx-a', ownerId: 'owner-b', enabled: false }), /owner_required/);
  r.setBridgeEnabled({ deviceId: 'tx-a', ownerId: 'owner-a', enabled: false });
  r.setOnline('tx-a', true);
  assert.equal(r.takeNext('tx-a'), null);
  assert.throws(() => r.enqueue({ jobId: 'blocked', deviceId: 'tx-a', receiverId: 'rx-1', operation: 'list' }), /device_offline/);
  assert.throws(() => r.complete({ jobId: 'pending', deviceId: 'tx-a', receiverId: 'rx-1' }), /not_authorized/);
  assert.equal(r.listApproved('rx-1').find(x => x.id === 'tx-a').bridgeEnabled, false);
});

test('disabled Bridge survives restart and requires owner reactivation', () => {
  const r = paired();
  r.setBridgeEnabled({ deviceId: 'tx-a', ownerId: 'owner-a', enabled: false });
  const restarted = BridgeRegistry.fromTrustedSnapshot(r.snapshot());
  assert.equal(restarted.listApproved('rx-1').find(x => x.id === 'tx-a').bridgeEnabled, false);
  restarted.setOnline('tx-a', true);
  assert.throws(() => restarted.enqueue({ jobId: 'job', deviceId: 'tx-a', receiverId: 'rx-1', operation: 'list' }), /device_offline/);
  restarted.setBridgeEnabled({ deviceId: 'tx-a', ownerId: 'owner-a', enabled: true });
  // A fresh authenticated connection is required after reactivation.
  restarted.setOnline('tx-a', true);
  restarted.enqueue({ jobId: 'job', deviceId: 'tx-a', receiverId: 'rx-1', operation: 'list' });
  assert.equal(restarted.takeNext('tx-a').jobId, 'job');
});

test('status distinguishes intentional closure from temporary network outage', () => {
  const r = paired();
  assert.equal(r.getDeviceStatus({ deviceId: 'tx-a', receiverId: 'rx-1' }).state, 'online');
  r.setOnline('tx-a', false);
  assert.equal(r.getDeviceStatus({ deviceId: 'tx-a', receiverId: 'rx-1' }).state, 'offline');
  r.setBridgeEnabled({ deviceId: 'tx-a', ownerId: 'owner-a', enabled: false });
  assert.equal(r.getDeviceStatus({ deviceId: 'tx-a', receiverId: 'rx-1' }).state, 'closed_by_owner');
  r.setOnline('tx-a', true);
  assert.equal(r.getDeviceStatus({ deviceId: 'tx-a', receiverId: 'rx-1' }).state, 'closed_by_owner');
  assert.equal(r.listApproved('rx-1').find(x => x.id === 'tx-a').online, false);
  assert.throws(() => r.getDeviceStatus({ deviceId: 'tx-a', receiverId: 'rx-2' }), /not_authorized/);
  r.setBridgeEnabled({ deviceId: 'tx-a', ownerId: 'owner-a', enabled: true });
  assert.equal(r.getDeviceStatus({ deviceId: 'tx-a', receiverId: 'rx-1' }).state, 'offline');
  r.setOnline('tx-a', true);
  assert.equal(r.getDeviceStatus({ deviceId: 'tx-a', receiverId: 'rx-1' }).state, 'online');
});

test('new devices start with Bridge disabled even when network announces online', () => {
  const r = new BridgeRegistry();
  r.registerDevice({ id: 'fresh', ownerId: 'owner', label: 'Fresh' });
  r.grant({ deviceId: 'fresh', receiverId: 'rx', approvedByOwnerId: 'owner' });
  r.setOnline('fresh', true);
  assert.equal(r.getDeviceStatus({ deviceId: 'fresh', receiverId: 'rx' }).state, 'closed_by_owner');
  assert.equal(r.listApproved('rx')[0].online, false);
  assert.throws(() => r.enqueue({ jobId: 'j', deviceId: 'fresh', receiverId: 'rx', operation: 'list' }), /device_offline/);
  const rebooted = BridgeRegistry.fromTrustedSnapshot(r.snapshot());
  assert.equal(rebooted.getDeviceStatus({ deviceId: 'fresh', receiverId: 'rx' }).state, 'closed_by_owner');
});

test('active revocation advances the TX session generation exactly once', () => {
  const r = paired();
  const first = r.getSessionEpoch('tx-a');
  const other = r.getSessionEpoch('tx-b');
  r.revoke({ deviceId: 'tx-a', receiverId: 'rx-1', approvedByOwnerId: 'owner-a' });
  assert.equal(r.getSessionEpoch('tx-a'), first + 1);
  assert.equal(r.getSessionEpoch('tx-b'), other);
  r.revoke({ deviceId: 'tx-a', receiverId: 'rx-1', approvedByOwnerId: 'owner-a' });
  assert.equal(r.getSessionEpoch('tx-a'), first + 1);
  r.grant({ deviceId: 'tx-a', receiverId: 'rx-1', approvedByOwnerId: 'owner-a' });
  assert.equal(r.getSessionEpoch('tx-a'), first + 1);
});
