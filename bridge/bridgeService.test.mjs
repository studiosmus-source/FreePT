import test from 'node:test';
import assert from 'node:assert/strict';
import { BridgeRegistry } from './deviceRouting.mjs';
import { BridgeDeviceCredentials } from './deviceCredentials.mjs';
import { BridgeDeviceSessionGate } from './deviceSessions.mjs';
import { BridgeService } from './bridgeService.mjs';

function setup() {
  const registry = new BridgeRegistry();
  const credentials = new BridgeDeviceCredentials();
  for (const [id, ownerId] of [['tx-a','owner-a'],['tx-b','owner-b']]) {
    registry.registerDevice({ id, ownerId, label: id });
    registry.grant({ deviceId: id, receiverId: 'admin-1', approvedByOwnerId: ownerId });
    registry.setBridgeEnabled({ deviceId: id, ownerId, enabled: true });
    registry.setOnline(id, true);
  }
  const a = credentials.issue('tx-a');
  const b = credentials.issue('tx-b');
  const sessions = new BridgeDeviceSessionGate({ registry, credentials });
  const service = new BridgeService({
    registry, sessions,
    authenticateAdmin: async context =>
      context === 'verified-admin' ? { id: 'admin-1', role: 'admin', approved: true } : null
  });
  return { registry, credentials, sessions, service, a, b };
}

test('verified admin queues a list job, correct TX collects and completes it', async () => {
  const { service, sessions, a, b } = setup();
  await service.requestList({ authContext:'verified-admin', deviceId:'tx-a', jobId:'job-1' });
  const txA = sessions.open({ deviceId:'tx-a', secret:a.secret });
  const txB = sessions.open({ deviceId:'tx-b', secret:b.secret });
  assert.equal(service.pollDevice({ deviceId:'tx-b', sessionToken:txB.token }), null);
  assert.equal(service.pollDevice({ deviceId:'tx-a', sessionToken:txA.token }).jobId, 'job-1');
  assert.equal(service.completeDevice({ deviceId:'tx-a', sessionToken:txA.token, jobId:'job-1' }).state, 'done');
});

test('unverified admin cannot queue even if claiming receiver ID', async () => {
  const { service } = setup();
  await assert.rejects(() => service.requestList({
    authContext:{ id:'admin-1', role:'admin', approved:true }, deviceId:'tx-a', jobId:'fake'
  }), /bridge_admin_required/);
});

test('wrong TX session cannot steal queued jobs or complete another TX work', async () => {
  const { service, sessions, a, b } = setup();
  await service.requestList({ authContext:'verified-admin', deviceId:'tx-a', jobId:'job-2' });
  const txB = sessions.open({ deviceId:'tx-b', secret:b.secret });
  assert.throws(() => service.pollDevice({ deviceId:'tx-a', sessionToken:txB.token }), /invalid_device_session/);
  const txA = sessions.open({ deviceId:'tx-a', secret:a.secret });
  assert.equal(service.pollDevice({ deviceId:'tx-a', sessionToken:txA.token }).jobId, 'job-2');
  assert.throws(() => service.completeDevice({
    deviceId:'tx-b', sessionToken:txB.token, jobId:'job-2'
  }), /job_not_authorized/);
  assert.equal(service.completeDevice({ deviceId:'tx-a', sessionToken:txA.token, jobId:'job-2' }).state, 'done');
});

test('revoke and shutdown stop dispatch and completion', async () => {
  const { service, sessions, registry, a } = setup();
  await service.requestList({ authContext:'verified-admin', deviceId:'tx-a', jobId:'job-3' });
  const txA = sessions.open({ deviceId:'tx-a', secret:a.secret });
  assert.equal(service.pollDevice({ deviceId:'tx-a', sessionToken:txA.token }).jobId, 'job-3');
  registry.revoke({ deviceId:'tx-a', receiverId:'admin-1', approvedByOwnerId:'owner-a' });
  assert.throws(() => service.completeDevice({
    deviceId:'tx-a', sessionToken:txA.token, jobId:'job-3'
  }), /device_session_revoked/);
  await assert.rejects(() => service.requestList({
    authContext:'verified-admin', deviceId:'tx-a', jobId:'job-4'
  }), /bridge_not_authorized/);
});

test('invalid TX token cannot consume a pending job', async () => {
  const { service, sessions, a } = setup();
  await service.requestList({ authContext:'verified-admin', deviceId:'tx-a', jobId:'job-5' });
  assert.throws(() => service.pollDevice({
    deviceId:'tx-a', sessionToken:'invalid'
  }), /invalid_device_session/);
  const txA = sessions.open({ deviceId:'tx-a', secret:a.secret });
  assert.equal(service.pollDevice({ deviceId:'tx-a', sessionToken:txA.token }).jobId, 'job-5');
});

test('only verified requesting admin can see or cancel a job', async () => {
  const { service, sessions, a } = setup();
  await service.requestList({ authContext:'verified-admin', deviceId:'tx-a', jobId:'cancel-1' });
  assert.equal((await service.getRequestStatus({
    authContext:'verified-admin', jobId:'cancel-1'
  })).state, 'queued');
  await assert.rejects(() => service.cancelRequest({
    authContext:{ id:'admin-1', role:'admin', approved:true }, jobId:'cancel-1'
  }), /bridge_admin_required/);
  assert.equal((await service.cancelRequest({
    authContext:'verified-admin', jobId:'cancel-1'
  })).state, 'cancelled');
  const tx = sessions.open({ deviceId:'tx-a', secret:a.secret });
  assert.equal(service.pollDevice({ deviceId:'tx-a', sessionToken:tx.token }), null);
  await assert.rejects(() => service.getRequestStatus({
    authContext:'verified-admin', jobId:'cancel-1'
  }), /job_not_authorized/);
});

test('request cancellation works on a sent job and prevents completion', async () => {
  const { service, sessions, a } = setup();
  await service.requestList({ authContext:'verified-admin', deviceId:'tx-a', jobId:'cancel-2' });
  const tx = sessions.open({ deviceId:'tx-a', secret:a.secret });
  assert.equal(service.pollDevice({ deviceId:'tx-a', sessionToken:tx.token }).state, 'sent');
  assert.equal((await service.cancelRequest({
    authContext:'verified-admin', jobId:'cancel-2'
  })).state, 'cancelled');
  assert.throws(() => service.completeDevice({
    deviceId:'tx-a', sessionToken:tx.token, jobId:'cancel-2'
  }), /job_not_authorized/);
});
