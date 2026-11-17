import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const migration=new URL('../supabase/migrations/20261106_bridge_jobs_staging.sql',import.meta.url);
const owner=new URL('../supabase/migrations/20261106_bridge_owner_controls.sql',import.meta.url);
const sql=()=>readFile(migration,'utf8');
function body(source,name) {
  return source.split('create or replace function public.'+name)[1]?.split('$$;')[0];
}

test('staging job migration is additive, isolated and enables strict job RLS',async ()=>{
  const source=await sql();
  assert.match(source,/create table if not exists public\.bridge_jobs\s*\(/i);
  assert.match(source,/alter table public\.bridge_jobs enable row level security/i);
  assert.match(source,/revoke all on public\.bridge_jobs from public, anon, authenticated/i);
  assert.doesNotMatch(source,/create policy .* on public\.bridge_jobs/i);
  assert.doesNotMatch(source,/alter table public\.(?:profiles|messages)\b/i);
  assert.doesNotMatch(source,/(?:drop|truncate) table public\./i);
  assert.doesNotMatch(source,/grant (?:select|insert|update|delete) on public\.bridge_jobs to (?:authenticated|anon)/i);
});

test('jobs are bounded to list operation, expiration and session digest',async ()=>{
  const source=await sql();
  assert.match(source,/operation\s+text[^\n]*check\s*\(operation = 'list'\)/i);
  assert.match(source,/state in \('queued', 'sent', 'done', 'cancelled'\)/i);
  assert.match(source,/session_binding_hex text check/i);
  assert.match(source,/session_binding_hex ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(source,/expires_at timestamptz not null/i);
  assert.match(source,/check \(expires_at > created_at\)/i);
  assert.doesNotMatch(source,/\bdevice_secret\s+text\b/i);
});

test('server job operations lock the same device row as owner controls',async ()=>{
  const source=await sql();
  const ownerSql=await readFile(owner,'utf8');
  for(const name of ['bridge_owner_set_enabled','bridge_owner_grant','bridge_owner_revoke']) {
    assert.match(body(ownerSql,name),/from public\.bridge_devices[\s\S]*?for update\s*;/i);
  }
  for(const name of ['bridge_server_enqueue_list','bridge_server_claim_list','bridge_server_complete_list']){
    const fn=body(source,name);
    assert.ok(fn,name+' missing');
    assert.match(fn,/from public\.bridge_devices d[\s\S]*?for update\s*;/i);
    assert.match(fn,/d\.bridge_enabled=true/i);
    assert.match(fn,/language plpgsql security invoker set search_path = ''/i);
  }
});

test('each job transition checks active grant and approved admin',async ()=>{
  const source=await sql();
  for(const name of ['bridge_server_enqueue_list','bridge_server_claim_list','bridge_server_complete_list']){
    const fn=body(source,name);
    assert.match(fn,/public\.bridge_grants/i);
    assert.match(fn,/public\.profiles/i);
    assert.match(fn,/revoked_at is null/i);
    assert.match(fn,/role='admin'/i);
    assert.match(fn,/status='approved'/i);
  }
  assert.match(body(source,'bridge_server_claim_list'),/order by j\.created_at, j\.id\s+limit 1\s+for update of j/i);
  assert.match(body(source,'bridge_server_complete_list'),/v_job\.session_binding_hex is distinct from p_session_binding_hex/i);
});

test('server-only functions have explicit execute grants and deny PUBLIC, anon and authenticated',async ()=>{
  const source=await sql();
  for(const signature of [
    'bridge_server_enqueue_list(uuid,uuid,uuid)',
    'bridge_server_claim_list(uuid,text)',
    'bridge_server_complete_list(uuid,uuid,text)'
  ]) {
    const escaped=signature.replace(/[.*+?^$\{\}()|[\]\\]/g,'\\$&');
    assert.match(source,new RegExp('revoke all on function public\\.'+escaped+'\\s+from public, anon, authenticated','i'));
    assert.match(source,new RegExp('grant execute on function public\\.'+escaped+'\\s+to service_role','i'));
  }
});

test('no SQL function accepts client-provided receiver for claim/completion',async ()=>{
  const source=await sql();
  for(const name of ['bridge_server_claim_list','bridge_server_complete_list']){
    const signature=source.split('create or replace function public.'+name)[1]?.split(') returns')[0];
    assert.ok(signature);
    assert.doesNotMatch(signature,/p_receiver_id/i);
  }
});
