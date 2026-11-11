import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const file = new URL('../supabase/migrations/20261106_bridge_owner_controls.sql', import.meta.url);
const sql = () => readFile(file, 'utf8');

test('each owner RPC derives identity from auth and locks its own device', async () => {
  const source = await sql();
  for (const name of ['bridge_owner_set_enabled', 'bridge_owner_grant', 'bridge_owner_revoke']) {
    const body = source.split('create or replace function public.' + name)[1]
      ?.split('$$;')[0];
    assert.ok(body, name + ' missing');
    assert.match(body, /auth\.uid\(\)/);
    assert.match(body, /public\.freept_is_approved\(\)/);
    assert.match(body, /owner_id\s*=\s*\(select auth\.uid\(\)\)/);
    assert.match(body, /for update\s*;/);
    assert.match(body, /raise exception 'bridge_owner_required'/);
  }
});

test('owner grants only approved admins and revoke is scoped to one pair', async () => {
  const source = await sql();
  const grant = source.split('create or replace function public.bridge_owner_grant')[1]
    ?.split('$$;')[0];
  const revoke = source.split('create or replace function public.bridge_owner_revoke')[1]
    ?.split('$$;')[0];
  assert.match(grant, /p\.role\s*=\s*'admin'/);
  assert.match(grant, /p\.status\s*=\s*'approved'/);
  assert.match(grant, /on conflict\s*\(device_id,\s*receiver_id\)/i);
  assert.match(revoke, /where device_id\s*=\s*p_device_id and receiver_id\s*=\s*p_receiver_id/);
  assert.match(revoke, /revoked_at is null/);
});

test('owner RPCs never expose direct table writes or register devices', async () => {
  const source = await sql();
  assert.doesNotMatch(source, /grant\s+(?:insert|update|delete)\s+on\s+public\.bridge_/i);
  assert.doesNotMatch(source, /insert\s+into\s+public\.bridge_devices/i);
  assert.doesNotMatch(source, /alter\s+table\s+public\.(?:messages|profiles)/i);
  for (const name of ['bridge_owner_set_enabled(uuid, boolean)', 'bridge_owner_grant(uuid, uuid)', 'bridge_owner_revoke(uuid, uuid)']) {
    assert.ok(source.includes('revoke all on function public.' + name), name + ' revoke missing');
    assert.ok(source.includes('grant execute on function public.' + name), name + ' grant missing');
  }
});
