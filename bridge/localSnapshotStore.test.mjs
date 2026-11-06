import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BridgeRegistry } from './deviceRouting.mjs';
import { LocalBridgeSnapshotStore } from './localSnapshotStore.mjs';

test('snapshot survives local process restart; online and jobs never persist', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'bridge-snapshot-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const path = join(folder, 'bridge.json');
  const store = new LocalBridgeSnapshotStore(path);
  const registry = await store.load();
  registry.registerDevice({ id: 'tx-1', ownerId: 'owner-1', label: 'Telefono 1' });
  registry.setOnline('tx-1', true);
  registry.grant({ deviceId: 'tx-1', receiverId: 'admin', approvedByOwnerId: 'owner-1' });
  registry.enqueue({ jobId: 'old-job', deviceId: 'tx-1', receiverId: 'admin', operation: 'list' });
  await store.save(registry);
  const restarted = await new LocalBridgeSnapshotStore(path).load();
  assert.equal(restarted.listApproved('admin').length, 1);
  assert.equal(restarted.listApproved('admin')[0].online, false);
  restarted.setOnline('tx-1', true);
  assert.equal(restarted.takeNext('tx-1'), null);
});

test('revocation stays revoked after local restart', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'bridge-snapshot-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const store = new LocalBridgeSnapshotStore(join(folder, 'bridge.json'));
  const r = await store.load();
  r.registerDevice({ id: 'tx', ownerId: 'owner', label: 'Phone' });
  r.grant({ deviceId: 'tx', receiverId: 'rx', approvedByOwnerId: 'owner' });
  await store.save(r);
  r.revoke({ deviceId: 'tx', receiverId: 'rx', approvedByOwnerId: 'owner' });
  await store.save(r);
  const restored = await store.load();
  assert.equal(restored.listApproved('rx').length, 0);
  assert.deepEqual((await readdir(folder)).filter(x => x.endsWith('.tmp')), []);
});

test('corrupt persisted data fails closed without overwriting original', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'bridge-snapshot-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const file = join(folder, 'bridge.json');
  await writeFile(file, '{"version":1,"devices":[],"grants":[{"deviceId":"ghost","receiverId":"rx"}]}');
  const store = new LocalBridgeSnapshotStore(file);
  await assert.rejects(() => store.load(), /invalid_snapshot/);
  assert.match(await readFile(file, 'utf8'), /ghost/);
});
