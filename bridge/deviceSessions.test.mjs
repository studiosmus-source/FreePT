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
  assert.throws(() => gate.authorize({ token: session.token, deviceId: 'tx-a', receiverId: 'rx-1' }), /bridge_not_authorized/);
  registry.grant({ deviceId: 'tx-a', receiverId: 'rx-1', approvedByOwnerId: 'owner-a' });
  registry.setBridgeEnabled({ deviceId: 'tx-a', ownerId: 'owner-a', enabled: false });
  assert.throws(() => gate.authorize({ token: session.token, deviceId: 'tx-a', receiverId: 'rx-1' }), /bridge_unavailable/);
});

test('network loss blocks operations without pretending consent was revoked', () => {
  const { gate, registry, a } = setup();
  const session = gate.open({ deviceId: 'tx-a', secret: a.secret });
  registry.setOnline('tx-a', false);
  assert.throws(() => gate.authorize({ token: session.token, deviceId: 'tx-a', receiverId: 'rx-1' }), /bridge_unavailable/);
  registry.setOnline('tx-a', true);
  assert.equal(gate.authorize({ token: session.token, deviceId: 'tx-a', receiverId: 'rx-1' }).deviceId, 'tx-a');
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
