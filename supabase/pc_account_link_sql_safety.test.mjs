import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const sql=readFileSync(new URL('./migrations/20261122_pc_account_linking_staging.sql',import.meta.url),'utf8');

test('desktop pairing is explicitly TEST-only and requires existing app and Bridge tables',()=>{
  assert.match(sql,/STAGING ONLY/i);
  assert.match(sql,/Never installs or runs in production/i);
  assert.match(sql,/PC_LINK STOP: required FreePT and Bridge tables are missing/);
});

test('pairing tables are private and codes are short-lived, hashed and attempt-limited',()=>{
  assert.match(sql,/alter table public\.freept_pc_device_links enable row level security/i);
  assert.match(sql,/alter table public\.freept_pc_link_requests enable row level security/i);
  assert.match(sql,/revoke all on public\.freept_pc_device_links, public\.freept_pc_link_requests\s+from public, anon, authenticated/i);
  assert.match(sql,/secret_hash bytea not null/i);
  assert.match(sql,/32-bit lookup key and a 64-bit one-time secret/i);
  assert.match(sql,/interval '5 minutes'/i);
  assert.match(sql,/attempts integer not null default 0 check \(attempts between 0 and 5\)/i);
  assert.match(sql,/interval '30 seconds'/i);
  assert.doesNotMatch(sql,/grant\s+(?:select|insert|update|delete|all)[\s\S]{0,100}freept_pc_(?:device_links|link_requests)/i);
});

test('only the approved user can link or revoke a PC, and every RPC has a closed search path',()=>{
  for(const name of ['freept_current_profile_id','freept_current_profile',
    'freept_pc_link_start','freept_pc_link_approve','freept_pc_link_list',
    'freept_pc_link_revoke']){
    const start=sql.indexOf('create or replace function public.'+name+'(');
    assert.ok(start>=0,name+' missing');
    const end=sql.indexOf('\n$$;',start);
    assert.ok(end>start,name+' body missing');
    const body=sql.slice(start,end+4);
    assert.match(body,/security definer/i,name);
    assert.match(body,/set search_path\s*=\s*''/i,name);
    assert.match(sql,new RegExp('revoke all on function public\\.'+name+'\\('),name+' must revoke PUBLIC');
    assert.match(sql,new RegExp('grant execute on function public\\.'+name+'\\('),name+' must grant explicitly');
  }
  assert.match(sql,/v_role is distinct from 'user'/i);
  assert.match(sql,/v_status is distinct from 'approved'/i);
  const hash=sql.slice(sql.indexOf('create or replace function public.freept_pc_link_hash('),
    sql.indexOf('\n$$;',sql.indexOf('create or replace function public.freept_pc_link_hash('))+4);
  assert.match(hash,/security definer/i);
  assert.match(hash,/set search_path\s*=\s*''/i);
  assert.match(sql,/revoke all on function public\.freept_pc_link_hash\(bytea\)\s+from public, anon, authenticated/i);
  assert.doesNotMatch(sql,/grant execute on function public\.freept_pc_link_hash\(bytea\)/i);
});

test('chat and file policies resolve the linked profile instead of the desktop Auth id',()=>{
  assert.match(sql,/sender_id=\(select public\.freept_current_profile_id\(\)\)/i);
  assert.match(sql,/user_id=\(select public\.freept_current_profile_id\(\)\)/i);
  assert.match(sql,/storage\.foldername\(name\)\)\[1\]=\s*\(select public\.freept_current_profile_id\(\)\)::text/i);
  assert.match(sql,/freept_pc_device_links l[\s\S]*?where l\.auth_user_id=\(select auth\.uid\(\)\) and l\.revoked_at is null/i);
});

test('PC revocation disables only Bridge devices created by that PC Auth session',()=>{
  assert.match(sql,/owner_auth_user_id uuid references auth\.users\(id\) on delete cascade/i);
  assert.match(sql,/owner_auth_user_id=p_auth_user_id/i);
  assert.match(sql,/set bridge_enabled=false/i);
  assert.match(sql,/set revoked_at=greatest\(clock_timestamp\(\),g\.approved_at\)/i);
  assert.match(sql,/p_owner_auth_user_id<>p_owner_id/i);
  assert.match(sql,/freept_pc_device_links l[\s\S]*?l\.revoked_at is null for share/i);
});
