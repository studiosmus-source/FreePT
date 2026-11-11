import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const file = new URL('../supabase/migrations/20261106_bridge_audit.sql', import.meta.url);

test('audit schema is isolated, owner read-only, and has no client writes', async () => {
  const sql = await readFile(file, 'utf8');
  assert.match(sql, /create table if not exists public\.bridge_audit_events/i);
  assert.match(sql, /alter table public\.bridge_audit_events enable row level security/i);
  assert.match(sql, /revoke all on public\.bridge_audit_events from public, anon, authenticated/i);
  assert.match(sql, /grant select on public\.bridge_audit_events to authenticated/i);
  assert.match(sql, /owner_id\s*=\s*\(select auth\.uid\(\)\)/i);
  assert.doesNotMatch(sql, /grant (?:insert|update|delete) on public\.bridge_audit_events/i);
  assert.doesNotMatch(sql, /alter table public\.(?:profiles|messages)\b/i);
});

test('audit records owner switch and grant revocation in the original transaction', async () => {
  const sql = await readFile(file, 'utf8');
  assert.match(sql, /after update of bridge_enabled on public\.bridge_devices/i);
  assert.match(sql, /after insert or update on public\.bridge_grants/i);
  assert.match(sql, /old\.bridge_enabled is distinct from new\.bridge_enabled/i);
  assert.match(sql, /old\.revoked_at is distinct from new\.revoked_at/i);
  for (const kind of ['bridge_enabled','bridge_disabled','access_granted','access_revoked']) {
    assert.ok(sql.includes("'" + kind + "'"));
  }
  assert.match(sql, /insert into public\.bridge_audit_events/i);
});

test('audit trigger helpers cannot be directly executed by app users', async () => {
  const sql = await readFile(file, 'utf8');
  for (const fn of ['bridge_audit_device_change','bridge_audit_grant_change']) {
    assert.match(sql, new RegExp('revoke all on function public\\.' + fn + '\\(\\) from public, anon, authenticated','i'));
    assert.doesNotMatch(sql, new RegExp('grant execute on function public\\.' + fn,'i'));
  }
  assert.match(sql, /security definer set search_path = ''/i);
});
