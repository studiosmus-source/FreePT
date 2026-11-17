import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const file = new URL('../supabase/migrations/20261106_bridge_device_verifiers.sql', import.meta.url);

test('device verifiers are one-to-one per TX and never store raw tokens', async () => {
  const sql = await readFile(file, 'utf8');
  assert.match(sql, /create table if not exists public\.bridge_device_verifiers\s*\(/i);
  assert.match(sql, /device_id uuid primary key references public\.bridge_devices\(id\) on delete cascade/i);
  assert.match(sql, /salt_hex text not null check/i);
  assert.match(sql, /verifier_hex text not null check/i);
  assert.doesNotMatch(sql, /^\s*(?:secret|token|bearer)_?(?:hex|text)?\s+text\b/im);
});

test('device verifier table cannot be queried or mutated by clients', async () => {
  const sql = await readFile(file, 'utf8');
  assert.match(sql, /alter table public\.bridge_device_verifiers enable row level security/i);
  assert.match(sql, /revoke all on public\.bridge_device_verifiers from public, anon, authenticated/i);
  assert.doesNotMatch(sql, /grant\s+(?:select|insert|update|delete)\s+on public\.bridge_device_verifiers\s+to\s+(?:anon|authenticated)/i);
  assert.doesNotMatch(sql, /create policy/i);
});
