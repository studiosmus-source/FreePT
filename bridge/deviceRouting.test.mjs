import test from 'node:test';
import assert from 'node:assert/strict';
import { BridgeRegistry } from './deviceRouting.mjs';

function paired() {
  const r = new BridgeRegistry();
  r.registerDevice({ id: 'tx-a', ownerId: 'owner-a', label: 'Telefono A' });
  r.registerDevice({ id: 'tx-b', ownerId: 'owner-b', label: 'Telefono B' });
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
  r.enqueue({ jobId: 'j', deviceId: 'tx-a', receiverId: 'rx-1', operation: 'read' });
  assert.throws(() => r.revoke({ deviceId: 'tx-a', receiverId: 'rx-1', approvedByOwnerId: 'owner-b' }), /owner_required/);
  r.revoke({ deviceId: 'tx-a', receiverId: 'rx-1', approvedByOwnerId: 'owner-a' });
  assert.deepEqual(r.listApproved('rx-1').map(x => x.id), ['tx-b']);
  assert.equal(r.takeNext('tx-a'), null);
  assert.throws(() => r.enqueue({ jobId: 'j2', deviceId: 'tx-a', receiverId: 'rx-1', operation: 'read' }), /not_authorized/);
});

test('offline and missing approvals fail closed', () => {
  const r = new BridgeRegistry();
  r.registerDevice({ id: 'tx', ownerId: 'owner', label: 'Tel' });
  assert.throws(() => r.grant({ deviceId: 'tx', receiverId: 'rx', approvedByOwnerId: 'stranger' }), /approval_required/);
  assert.throws(() => r.enqueue({ jobId: 'j', deviceId: 'tx', receiverId: 'rx', operation: 'list' }), /device_offline/);
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
  r.enqueue({ jobId: 'sent', deviceId: 'tx-a', receiverId: 'rx-1', operation: 'read' });
  assert.equal(r.takeNext('tx-a').jobId, 'sent');
  r.revoke({ deviceId: 'tx-a', receiverId: 'rx-1', approvedByOwnerId: 'owner-a' });
  assert.throws(() => r.complete({ jobId: 'sent', deviceId: 'tx-a', receiverId: 'rx-1' }), /not_authorized/);
  assert.equal(r.listApproved('rx-1').some(x => x.id === 'tx-a'), false);
});

test('punctuation in IDs cannot reuse authorization for another device', () => {
  const r = new BridgeRegistry();
  r.registerDevice({ id: 'a:b', ownerId: 'owner-1', label: 'Telefono 1' });
  r.registerDevice({ id: 'a', ownerId: 'owner-2', label: 'Telefono 2' });
  r.setOnline('a:b', true);
  r.setOnline('a', true);
  r.grant({ deviceId: 'a:b', receiverId: 'c', approvedByOwnerId: 'owner-1' });
  assert.deepEqual(r.listApproved('c').map(x => x.id), ['a:b']);
  assert.deepEqual(r.listApproved('b:c').map(x => x.id), []);
  assert.throws(() => r.enqueue({
    jobId: 'bad', deviceId: 'a', receiverId: 'b:c', operation: 'list'
  }), /not_authorized/);
});
