import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const body=source=>{
 const start=source.lastIndexOf('create or replace function public.bridge_server_job_status(');
 const end=source.indexOf('$$;',start);
 assert.ok(start>=0&&end>start);
 return source.slice(start,end+3);
};
test('fresh staging and existing-install upgrade agree on expired job states',()=>{
 for(const path of [
  'supabase/migrations/20261106_bridge_job_admin_staging.sql',
  'supabase/bridge_staging_install_once.sql',
  'supabase/migrations/20261120_bridge_job_status_expiry_staging.sql'
 ]){
  const sql=read(path),fn=body(sql);
  assert.match(fn,/v_job\.state in \('queued','sent'\)/);
  assert.match(fn,/v_job\.expires_at <= clock_timestamp\(\)/);
  assert.match(fn,/then 'expired' else v_job\.state end/);
  assert.match(fn,/v_job\.receiver_id|j\.receiver_id=p_receiver_id/);
  assert.match(fn,/security invoker/);
 }
});
test('staging upgrade is isolated to server-only job status and preserves access restrictions',()=>{
 const sql=read('supabase/migrations/20261120_bridge_job_status_expiry_staging.sql');
 assert.doesNotMatch(sql,/\b(?:drop|truncate|delete|insert|update)\s+(?:table\s+)?public\./i);
 assert.match(sql,/revoke all on function public\.bridge_server_job_status\(uuid,uuid\)/);
 assert.match(sql,/grant execute on function public\.bridge_server_job_status\(uuid,uuid\)[\s\S]*to service_role/);
 assert.doesNotMatch(sql,/create or replace function public\.bridge_server_cancel_job/);
});
test('staging delivery window covers Android recovery and shortens completed read-data retention',()=>{
  const migration=read('supabase/migrations/20261121_bridge_job_delivery_staging.sql');
  const bundle=read('supabase/bridge_staging_install_once.sql');
  for(const sql of [migration,bundle]){
    assert.match(sql,/new\.operation in \('list','read','browse','thumbnail'\)/);
    assert.match(sql,/interval '30 minutes'/);
    assert.match(sql,/new\.state='done' and\s+new\.operation='read'/);
    assert.match(sql,/interval '5 minutes'/);
    assert.match(sql,/before insert or update on public\.bridge_jobs/i);
  }
  assert.match(bundle,/byte_length integer not null check\(byte_length between 1 and 32768\)/);
  assert.match(bundle,/add constraint bridge_read_requests_byte_length_check\s+check \(byte_length >= 1 and byte_length <= 262144\)/i);
  assert.match(bundle,/p_length is null or p_length not between 1 and 262144/);
  assert.match(bundle,/length\(v_data\)>349528/);
  assert.doesNotMatch(migration,/\b(?:delete|truncate|drop\s+table|update\s+public\.)/i);
});
