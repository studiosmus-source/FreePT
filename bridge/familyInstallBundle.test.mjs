import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../supabase/'+name,import.meta.url),'utf8');
test('fresh staging bundle includes family authorization before COMMIT',()=>{
 const sql=read('bridge_staging_install_once.sql');
 assert.equal(sql.split('create or replace function public.bridge_owner_activate_family(').length,2);
 assert.ok(sql.indexOf('bridge_owner_activate_family(')<sql.lastIndexOf('\nCOMMIT;'));
 assert.match(sql,/BRIDGE STOP: Bridge already installed/);
 assert.match(sql,/BRIDGE STOP: missing staging FreePT identity prerequisites/);
});
test('existing staging upgrade requires a previously installed Bridge schema',()=>{
 const sql=read('bridge_family_existing_install_upgrade.sql');
 assert.match(sql,/BRIDGE STAGING STOP: existing Bridge schema prerequisite missing/);
 assert.match(sql,/to_regclass\('public\.bridge_devices'\)/);
 assert.match(sql,/bridge_owner_activate_family/);
 assert.match(sql,/revoke all on function public\.bridge_owner_activate_family\(uuid\) from public,anon/);
 assert.match(sql,/grant execute on function public\.bridge_owner_activate_family\(uuid\) to authenticated/);
 assert.match(sql,/anonymous_denied/);
 assert.doesNotMatch(sql,/(?:drop|truncate) table public\.(?:profiles|messages|bridge_devices)/i);
});
test('read-only staging preflight reports family activation readiness',()=>{
 const sql=read('bridge_preflight.sql');
 assert.match(sql,/Attivazione famiglia disponibile solo agli utenti approvati/);
 assert.match(sql,/bridge_owner_activate_family\(uuid\)/);
});
