import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectBridgeProductionData} from './productionReadiness.mjs';

function client(counts) {
  return {from(table) {
    const query = {
      select(column, options) {
        assert.deepEqual(options, {head: true, count: 'exact'});
        assert.equal(typeof column, 'string');
        return this;
      },
      eq(field, value) {
        assert.ok((field === 'role' && value === 'admin') ||
          (field === 'status' && value === 'approved'));
        return this;
      },
      then(resolve, reject) {
        const response = counts[table] === 'error'
          ? {count: null, error: {code: 'PGRST205', details: 'PRIVATE'}}
          : {count: counts[table], error: null};
        return Promise.resolve(response).then(resolve, reject);
      }
    };
    return query;
  }};
}

test('read-only probe reports categorical states without exposing data', async () => {
  const report = await inspectBridgeProductionData(client({
    bridge_devices: 1, bridge_grants: 0, bridge_device_verifiers: 1, profiles: 1
  }));
  assert.deepEqual(report, {
    devices: 'present', grants: 'empty', verifiers: 'present', approvedAdmin: 'unique'
  });
  assert.equal(Object.isFrozen(report), true);
  assert.equal(JSON.stringify(report).includes('PRIVATE'), false);
});

test('missing tables and unexpected counts do not throw or leak errors', async () => {
  const report = await inspectBridgeProductionData(client({
    bridge_devices: 'error', bridge_grants: undefined,
    bridge_device_verifiers: 0, profiles: 2
  }));
  assert.deepEqual(report, {
    devices: 'unavailable', grants: 'unavailable',
    verifiers: 'empty', approvedAdmin: 'multiple'
  });
});

test('missing client fails closed', async () => {
  await assert.rejects(() => inspectBridgeProductionData(null),
    /bridge_readiness_client_invalid/);
});
