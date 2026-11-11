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
  assert.equal((await service.getRequestStatus({
    authContext:'verified-admin', jobId:'cancel-1'
  })).state, 'cancelled');
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

test('completed status is visible to only the verified requesting admin', async () => {
  const { service, sessions, a } = setup();
  await service.requestList({ authContext:'verified-admin', deviceId:'tx-a', jobId:'done-visible' });
  const tx = sessions.open({ deviceId:'tx-a', secret:a.secret });
  service.pollDevice({ deviceId:'tx-a', sessionToken:tx.token });
  service.completeDevice({ deviceId:'tx-a', sessionToken:tx.token, jobId:'done-visible' });
  assert.equal((await service.getRequestStatus({
    authContext:'verified-admin', jobId:'done-visible'
  })).state, 'done');
  await assert.rejects(() => service.getRequestStatus({
    authContext:'unverified', jobId:'done-visible'
  }), /bridge_admin_required/);
  await assert.rejects(() => service.cancelRequest({
    authContext:'verified-admin', jobId:'done-visible'
  }), /job_already_final/);
});

test('two sessions of same TX cannot complete each other dispatched jobs', async () => {
  const { service, sessions, a } = setup();
  await service.requestList({ authContext:'verified-admin', deviceId:'tx-a', jobId:'session-bound' });
  const first = sessions.open({ deviceId:'tx-a', secret:a.secret });
  const second = sessions.open({ deviceId:'tx-a', secret:a.secret });
  assert.notEqual(first.token, second.token);
  const job = service.pollDevice({ deviceId:'tx-a', sessionToken:first.token });
  assert.equal(job.jobId, 'session-bound');
  assert.equal('sessionBinding' in job, false);
  assert.throws(() => service.completeDevice({
    deviceId:'tx-a', sessionToken:second.token, jobId:'session-bound'
  }), /job_not_authorized/);
  assert.equal(service.completeDevice({
    deviceId:'tx-a', sessionToken:first.token, jobId:'session-bound'
  }).state, 'done');
});

test('closing claiming session prevents a second TX session completing its work', async () => {
  const { service, sessions, a } = setup();
  await service.requestList({ authContext:'verified-admin', deviceId:'tx-a', jobId:'closed-claim' });
  const first = sessions.open({ deviceId:'tx-a', secret:a.secret });
  service.pollDevice({ deviceId:'tx-a', sessionToken:first.token });
  sessions.close(first.token);
  const second = sessions.open({ deviceId:'tx-a', secret:a.secret });
  assert.throws(() => service.completeDevice({
    deviceId:'tx-a', sessionToken:first.token, jobId:'closed-claim'
  }), /invalid_device_session/);
  assert.throws(() => service.completeDevice({
    deviceId:'tx-a', sessionToken:second.token, jobId:'closed-claim'
  }), /job_not_authorized/);
});

test('service authenticates cold TX connect then processes approved admin job', async () => {
  const {service, registry, a} = setup();
  registry.setOnline('tx-a', false);
  assert.equal(registry.getDeviceStatus({deviceId:'tx-a',receiverId:'admin-1'}).state,'offline');
  assert.throws(() => service.connectDevice({
    deviceId:'tx-a',deviceSecret:'not-valid'
  }), /device_not_authenticated/);
  const session = service.connectDevice({deviceId:'tx-a',deviceSecret:a.secret});
  await service.requestList({authContext:'verified-admin',deviceId:'tx-a',jobId:'cold-request'});
  assert.equal(service.pollDevice({
    deviceId:'tx-a',sessionToken:session.token
  }).jobId,'cold-request');
  assert.equal(service.completeDevice({
    deviceId:'tx-a',sessionToken:session.token,jobId:'cold-request'
  }).state,'done');
});

test('owner switch blocks service TX cold connect even with valid secret', () => {
  const {service,registry,a} = setup();
  registry.setBridgeEnabled({deviceId:'tx-a',ownerId:'owner-a',enabled:false});
  assert.throws(() => service.connectDevice({
    deviceId:'tx-a',deviceSecret:a.secret
  }), /bridge_unavailable/);
  assert.equal(registry.getDeviceStatus({deviceId:'tx-a',receiverId:'admin-1'}).state,'closed_by_owner');
});

test('reconnect cancels dispatched work but preserves pending work and other TX', async () => {
  const {service,registry,a,b} = setup();
  const txA = service.connectDevice({deviceId:'tx-a',deviceSecret:a.secret});
  const txB = service.connectDevice({deviceId:'tx-b',deviceSecret:b.secret});
  await service.requestList({authContext:'verified-admin',deviceId:'tx-a',jobId:'old-sent'});
  await service.requestList({authContext:'verified-admin',deviceId:'tx-a',jobId:'still-queued'});
  assert.equal(service.pollDevice({deviceId:'tx-a',sessionToken:txA.token}).jobId,'old-sent');
  const nextA = service.connectDevice({deviceId:'tx-a',deviceSecret:a.secret});
  assert.equal((await service.getRequestStatus({
    authContext:'verified-admin',jobId:'old-sent'
  })).state,'cancelled');
  assert.equal((await service.getRequestStatus({
    authContext:'verified-admin',jobId:'still-queued'
  })).state,'queued');
  assert.throws(() => service.completeDevice({
    deviceId:'tx-a',sessionToken:txA.token,jobId:'old-sent'
  }), /invalid_device_session/);
  assert.throws(() => service.completeDevice({
    deviceId:'tx-a',sessionToken:nextA.token,jobId:'old-sent'
  }), /job_not_authorized/);
  assert.equal(service.pollDevice({
    deviceId:'tx-a',sessionToken:nextA.token
  }).jobId,'still-queued');
  assert.equal(service.completeDevice({
    deviceId:'tx-a',sessionToken:nextA.token,jobId:'still-queued'
  }).state,'done');
  assert.equal(registry.getDeviceStatus({
    deviceId:'tx-b',receiverId:'admin-1'
  }).state,'online');
  assert.equal(service.pollDevice({deviceId:'tx-b',sessionToken:txB.token}),null);
});
