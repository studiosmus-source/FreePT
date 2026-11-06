import test from 'node:test';
import assert from 'node:assert/strict';
import { BridgeRegistry } from './deviceRouting.mjs';
import { BridgeDeviceCredentials } from './deviceCredentials.mjs';
import { BridgeDeviceSessionGate } from './deviceSessions.mjs';

function setup() {
  const registry = new BridgeRegistry();
  const credentials = new BridgeDeviceCredentials();
  let now = 1000;
  for (const [deviceId, ownerId] of [['tx-a','owner-a'],['tx-b','owner-b']]) {
    registry.registerDevice({ id: deviceId, ownerId, label: deviceId });
    registry.grant({ deviceId, receiverId: 'rx-1', approvedByOwnerId: ownerId });
    registry.setBridgeEnabled({ deviceId, ownerId, enabled: true });
    registry.setOnline(deviceId, true);
  }
  const a = credentials.issue('tx-a');
  const b = credentials.issue('tx-b');
  const gate = new BridgeDeviceSessionGate({ credentials, registry, now: () => now });
  return { registry, credentials, gate, a, b, advance: ms => { now += ms; } };
}

test('a session is specific to one authenticated device', () => {
  const { gate, a } = setup();
  const session = gate.open({ deviceId: 'tx-a', secret: a.secret });
  assert.deepEqual(gate.authorize({ token: session.token, deviceId: 'tx-a', receiverId: 'rx-1' }), {
    deviceId: 'tx-a', receiverId: 'rx-1'
  });
  assert.throws(() => gate.authorize({
    token: session.token, deviceId: 'tx-b', receiverId: 'rx-1'
  }), /invalid_device_session/);
  assert.throws(() => gate.open({ deviceId: 'tx-b', secret: a.secret }), /device_not_authenticated/);
});

test('rotation immediately invalidates the old in-memory session', () => {
  const { gate, credentials, a, b } = setup();
  const sessionA = gate.open({ deviceId: 'tx-a', secret: a.secret });
  const sessionB = gate.open({ deviceId: 'tx-b', secret: b.secret });
  credentials.rotate('tx-a');
  assert.throws(() => gate.authorize({ token: sessionA.token, deviceId: 'tx-a', receiverId: 'rx-1' }), /device_session_revoked/);
  assert.equal(gate.authorize({ token: sessionB.token, deviceId: 'tx-b', receiverId: 'rx-1' }).deviceId, 'tx-b');
});

test('revoked receiver grant and owner switch block active sessions', () => {
  const { gate, registry, a } = setup();
  const session = gate.open({ deviceId: 'tx-a', secret: a.secret });
  registry.revoke({ deviceId: 'tx-a', receiverId: 'rx-1', approvedByOwnerId: 'owner-a' });
  assert.throws(() => gate.authorize({ token: session.token, deviceId: 'tx-a', receiverId: 'rx-1' }), /device_session_revoked/);
  registry.grant({ deviceId: 'tx-a', receiverId: 'rx-1', approvedByOwnerId: 'owner-a' });
  registry.setBridgeEnabled({ deviceId: 'tx-a', ownerId: 'owner-a', enabled: false });
  // The first denied check already discarded the revoked token.
  assert.throws(() => gate.authorize({ token: session.token, deviceId: 'tx-a', receiverId: 'rx-1' }), /invalid_device_session/);
});

test('network loss invalidates old session but not owner consent', () => {
  const { gate, registry, a } = setup();
  const session = gate.open({ deviceId: 'tx-a', secret: a.secret });
  registry.setOnline('tx-a', false);
  assert.throws(() => gate.authorize({ token: session.token, deviceId: 'tx-a', receiverId: 'rx-1' }), /device_session_revoked/);
  assert.equal(registry.getDeviceStatus({ deviceId: 'tx-a', receiverId: 'rx-1' }).state, 'offline');
  registry.setOnline('tx-a', true);
  assert.throws(() => gate.authorize({ token: session.token, deviceId: 'tx-a', receiverId: 'rx-1' }), /invalid_device_session/);
  const fresh = gate.open({ deviceId: 'tx-a', secret: a.secret });
  assert.equal(gate.authorize({ token: fresh.token, deviceId: 'tx-a', receiverId: 'rx-1' }).deviceId, 'tx-a');
});

test('sessions expire after five minutes and reject malformed tokens', () => {
  const { gate, a, advance } = setup();
  const session = gate.open({ deviceId: 'tx-a', secret: a.secret });
  advance(300000);
  assert.throws(() => gate.authorize({ token: session.token, deviceId: 'tx-a', receiverId: 'rx-1' }), /device_session_expired/);
  assert.throws(() => gate.authorize({ token: 'invalid', deviceId: 'tx-a', receiverId: 'rx-1' }), /invalid_device_session/);
  assert.equal(gate.close('invalid'), false);
});

test('explicit session close makes the token unusable', () => {
  const { gate, a } = setup();
  const session = gate.open({ deviceId: 'tx-a', secret: a.secret });
  assert.equal(gate.close(session.token), true);
  assert.equal(gate.close(session.token), false);
  assert.throws(() => gate.authorize({ token: session.token, deviceId: 'tx-a', receiverId: 'rx-1' }), /invalid_device_session/);
});

test('off then on never resurrects an earlier device session', () => {
  const { gate, registry, a } = setup();
  const previous = gate.open({ deviceId: 'tx-a', secret: a.secret });
  registry.setBridgeEnabled({ deviceId: 'tx-a', ownerId: 'owner-a', enabled: false });
  registry.setBridgeEnabled({ deviceId: 'tx-a', ownerId: 'owner-a', enabled: true });
  registry.setOnline('tx-a', true);
  assert.throws(() => gate.authorize({
    token: previous.token, deviceId: 'tx-a', receiverId: 'rx-1'
  }), /device_session_revoked/);
  const fresh = gate.open({ deviceId: 'tx-a', secret: a.secret });
  assert.equal(gate.authorize({ token: fresh.token, deviceId: 'tx-a', receiverId: 'rx-1' }).deviceId, 'tx-a');
});

test('credential deletion invalidates live session even with active grant', () => {
  const { gate, credentials, a } = setup();
  const session = gate.open({ deviceId: 'tx-a', secret: a.secret });
  credentials.revoke('tx-a');
  assert.throws(() => gate.authorize({
    token: session.token, deviceId: 'tx-a', receiverId: 'rx-1'
  }), /device_session_revoked/);
});

test('sessions cannot start when Bridge is disabled or disconnected', () => {
  const { gate, registry, a } = setup();
  registry.setOnline('tx-a', false);
  assert.throws(() => gate.open({ deviceId: 'tx-a', secret: a.secret }), /bridge_unavailable/);
  registry.setOnline('tx-a', true);
  registry.setBridgeEnabled({ deviceId: 'tx-a', ownerId: 'owner-a', enabled: false });
  assert.throws(() => gate.open({ deviceId: 'tx-a', secret: a.secret }), /bridge_unavailable/);
});

test('regrant never revives a TX session authorized before revocation', () => {
  const { gate, registry, a, b } = setup();
  const oldA = gate.open({ deviceId: 'tx-a', secret: a.secret });
  const unaffectedB = gate.open({ deviceId: 'tx-b', secret: b.secret });
  assert.equal(gate.authorize({
    token: oldA.token, deviceId: 'tx-a', receiverId: 'rx-1'
  }).deviceId, 'tx-a');
  registry.revoke({ deviceId: 'tx-a', receiverId: 'rx-1', approvedByOwnerId: 'owner-a' });
  registry.grant({ deviceId: 'tx-a', receiverId: 'rx-1', approvedByOwnerId: 'owner-a' });
  assert.throws(() => gate.authorize({
    token: oldA.token, deviceId: 'tx-a', receiverId: 'rx-1'
  }), /device_session_revoked/);
  const newA = gate.open({ deviceId: 'tx-a', secret: a.secret });
  assert.equal(gate.authorize({
    token: newA.token, deviceId: 'tx-a', receiverId: 'rx-1'
  }).deviceId, 'tx-a');
  assert.equal(gate.authorize({
    token: unaffectedB.token, deviceId: 'tx-b', receiverId: 'rx-1'
  }).deviceId, 'tx-b');
});

test('repeating a non-active revoke does not invalidate a fresh session', () => {
  const { gate, registry, a } = setup();
  registry.revoke({ deviceId: 'tx-a', receiverId: 'rx-1', approvedByOwnerId: 'owner-a' });
  registry.grant({ deviceId: 'tx-a', receiverId: 'rx-1', approvedByOwnerId: 'owner-a' });
  const fresh = gate.open({ deviceId: 'tx-a', secret: a.secret });
  // This revocation targets no active grant after a prior revoke.
  registry.revoke({ deviceId: 'tx-a', receiverId: 'missing', approvedByOwnerId: 'owner-a' });
  assert.equal(gate.authorize({
    token: fresh.token, deviceId: 'tx-a', receiverId: 'rx-1'
  }).deviceId, 'tx-a');
});

test('authenticated TX connects from offline without a circular online prerequisite', () => {
  const { gate, registry, a } = setup();
  registry.setOnline('tx-a', false);
  assert.equal(registry.getDeviceStatus({ deviceId:'tx-a', receiverId:'rx-1' }).state, 'offline');
  const connected = gate.connect({ deviceId:'tx-a', secret:a.secret });
  assert.equal(registry.getDeviceStatus({ deviceId:'tx-a', receiverId:'rx-1' }).state, 'online');
  assert.equal(gate.authorize({
    token: connected.token, deviceId:'tx-a', receiverId:'rx-1'
  }).deviceId, 'tx-a');
});

test('invalid TX secret never marks an offline device online', () => {
  const { gate, registry, a, b } = setup();
  registry.setOnline('tx-a', false);
  assert.throws(() => gate.connect({deviceId:'tx-a',secret:b.secret}), /device_not_authenticated/);
  assert.throws(() => gate.connect({deviceId:'tx-a',secret:'invalid'}), /device_not_authenticated/);
  assert.equal(registry.getDeviceStatus({deviceId:'tx-a',receiverId:'rx-1'}).state, 'offline');
  assert.equal(gate.connect({deviceId:'tx-a',secret:a.secret}).token.length, 64);
});

test('owner-disabled Bridge refuses authenticated TX reconnect', () => {
  const { gate, registry, a } = setup();
  registry.setBridgeEnabled({deviceId:'tx-a',ownerId:'owner-a',enabled:false});
  assert.throws(() => gate.connect({deviceId:'tx-a',secret:a.secret}), /bridge_unavailable/);
  assert.equal(registry.getDeviceStatus({deviceId:'tx-a',receiverId:'rx-1'}).state, 'closed_by_owner');
  registry.setBridgeEnabled({deviceId:'tx-a',ownerId:'owner-a',enabled:true});
  const active = gate.connect({deviceId:'tx-a',secret:a.secret});
  assert.equal(gate.authorize({token:active.token,deviceId:'tx-a',receiverId:'rx-1'}).deviceId,'tx-a');
});

test('cold restored registry connects only after device authentication', () => {
  const { registry, credentials, a } = setup();
  const rebooted = BridgeRegistry.fromTrustedSnapshot(registry.snapshot());
  const gate = new BridgeDeviceSessionGate({registry: rebooted, credentials});
  assert.equal(rebooted.getDeviceStatus({deviceId:'tx-a',receiverId:'rx-1'}).state,'offline');
  assert.throws(() => gate.open({deviceId:'tx-a',secret:a.secret}), /bridge_unavailable/);
  const session = gate.connect({deviceId:'tx-a',secret:a.secret});
  assert.equal(gate.authorize({token:session.token,deviceId:'tx-a',receiverId:'rx-1'}).deviceId,'tx-a');
});

test('authenticated reconnect supersedes an earlier session for the same device', () => {
  const { gate, registry, a, b } = setup();
  const oldA = gate.connect({ deviceId:'tx-a', secret:a.secret });
  const other = gate.connect({ deviceId:'tx-b', secret:b.secret });
  const epoch = registry.getSessionEpoch('tx-a');
  const fresh = gate.connect({ deviceId:'tx-a', secret:a.secret });
  assert.notEqual(fresh.token, oldA.token);
  assert.equal(registry.getSessionEpoch('tx-a'), epoch + 1);
  assert.throws(() => gate.authorize({
    token:oldA.token,deviceId:'tx-a',receiverId:'rx-1'
  }), /device_session_revoked/);
  assert.equal(gate.authorize({
    token:fresh.token,deviceId:'tx-a',receiverId:'rx-1'
  }).deviceId,'tx-a');
  assert.equal(gate.authorize({
    token:other.token,deviceId:'tx-b',receiverId:'rx-1'
  }).deviceId,'tx-b');
});

test('invalid reconnect secret does not invalidate an active TX connection', () => {
  const { gate, registry, a, b } = setup();
  const current = gate.connect({ deviceId:'tx-a', secret:a.secret });
  const epoch = registry.getSessionEpoch('tx-a');
  assert.throws(() => gate.connect({
    deviceId:'tx-a',secret:b.secret
  }), /device_not_authenticated/);
  assert.equal(registry.getSessionEpoch('tx-a'), epoch);
  assert.equal(gate.authorize({
    token:current.token,deviceId:'tx-a',receiverId:'rx-1'
  }).deviceId,'tx-a');
});
