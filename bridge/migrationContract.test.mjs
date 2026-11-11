import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = new URL('../supabase/migrations/20261106_bridge_foundation.sql', import.meta.url);

test('Bridge SQL remains isolated from FreePT chat tables and starts disabled', async () => {
  const sql = await readFile(migration, 'utf8');
  assert.match(sql, /create table if not exists public\.bridge_devices\s*\(/i);
  assert.match(sql, /create table if not exists public\.bridge_grants\s*\(/i);
  assert.match(sql, /bridge_enabled boolean not null default false/i);
  assert.doesNotMatch(sql, /alter table public\.(?:messages|profiles)\b/i);
  assert.doesNotMatch(sql, /(?:drop|truncate) table public\.(?:messages|profiles)\b/i);
});

test('Bridge SQL refuses direct client writes and enables RLS', async () => {
  const sql = await readFile(migration, 'utf8');
  for (const name of ['bridge_devices', 'bridge_grants']) {
    assert.match(sql, new RegExp('alter table public\\.' + name + ' enable row level security', 'i'));
    assert.match(sql, new RegExp('revoke all on public\\.' + name + ' from public, anon, authenticated', 'i'));
  }
  assert.match(sql, /grant select on public\.bridge_devices to authenticated/i);
  assert.match(sql, /grant select on public\.bridge_grants to authenticated/i);
});

test('Bridge SQL admin helper has valid paired dollar quote delimiters', async () => {
  const sql = await readFile(migration, 'utf8');
  const helper = sql.split('create or replace function public.bridge_admin_has_active_grant')[1]
    ?.split('revoke all on function public.bridge_admin_has_active_grant')[0];
  assert.ok(helper, 'admin helper missing');
  assert.match(helper, /\bas \$\$\s*select/i);
  assert.match(helper, /\$\$;/);
  assert.doesNotMatch(helper, /\bas \$\s*select/i);
});
