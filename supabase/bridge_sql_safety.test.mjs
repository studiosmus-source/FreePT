import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const sql=readFileSync(new URL('./bridge_staging_install_once.sql',import.meta.url),'utf8');
const sections=[...sql.matchAll(/^-- ===== (\d+)\/(?:13|14): (.+) =====$/gm)];
const functionNames=[...sql.matchAll(/create or replace function\s+public\.([a-z_]+)\s*\(/gi)].map(x=>x[1]);
const frequencies=Object.create(null);
for(const name of functionNames) frequencies[name]=(frequencies[name]??0)+1;

test('staging bundle remains explicitly test-only',()=>{
 assert.match(sql,/NEVER run on the production FreePT project/);
 assert.match(sql,/aqjuixbuxtnjfzxmzuj/);
 assert.match(sql,/BEGIN;[\s\S]*COMMIT;/);
});
test('staging bundle contains 14 ordered migration sections',()=>{
 assert.equal(sections.length,14);
 assert.deepEqual(sections.map(x=>Number(x[1])),Array.from({length:14},(_,i)=>i+1));
});
test('replaced RPCs are explicit and reviewed rather than accidental',()=>{
 assert.deepEqual(Object.entries(frequencies).filter(([,n])=>n>1).sort(),
 [['bridge_server_claim_list',3],['bridge_server_complete_list',3]]);
});
test('schema DDL and direct data mutations target only bridge tables',()=>{
 const targets=[...sql.matchAll(/\b(?:create\s+table\s+(?:if\s+not\s+exists\s+)?|alter\s+table\s+|delete\s+from\s+|update\s+)public\.([a-z_]+)/gi)].map(x=>x[1]);
 assert.ok(targets.length>20);
 assert.ok(targets.every(name=>name.startsWith('bridge_')),targets.filter(name=>!name.startsWith('bridge_')).join(', '));
});
test('production read-only readiness check does not contain writes',()=>{
 const preflight=readFileSync(new URL('./bridge_production_readiness_readonly.sql',import.meta.url),'utf8');
 const withoutComments=preflight.replace(/^--.*$/gm,'');
 assert.doesNotMatch(withoutComments,/\b(?:insert|update|delete|drop|alter|truncate|create|grant|revoke)\s+(?:into|from|table|function|policy|trigger|on|role)?\b/i);
});

test('Bridge bundle does not create or replace unrelated FreePT functions',()=>{
 const declared=[...sql.matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z_]+)/gi)].map(m=>m[1]);
 assert.ok(declared.length>=20);
 assert.ok(declared.every(name=>name.startsWith('bridge_')));
});
test('Bridge table foreign keys reference only existing profiles or Bridge tables',()=>{
 const refs=[...sql.matchAll(/references\s+public\.([a-z_]+)/gi)].map(m=>m[1]);
 assert.ok(refs.length>=5);
 assert.ok(refs.every(name=>name==='profiles'||name.startsWith('bridge_')));
});
test('all Bridge security-definer function definitions set an empty search path',()=>{
 const definitions=[...sql.matchAll(/create\s+or\s+replace\s+function\s+public\.[a-z_]+\s*\([\s\S]*?\)\s*returns\s+[\s\S]*?\bas\s+\$\$/gi)].map(m=>m[0]);
 assert.ok(definitions.length>=10);
 for(const def of definitions){
   if(/security\s+definer/i.test(def))assert.match(def,/set\s+search_path\s*=\s*''/i);
 }
});

test('final list RPCs retain session fencing and list-only job guards',()=>{
 for(const name of ['bridge_server_claim_list','bridge_server_complete_list']){
   const needle='create or replace function public.'+name+'(';
   const starts=[];
   for(let at=sql.indexOf(needle);at!==-1;at=sql.indexOf(needle,at+needle.length))starts.push(at);
   assert.equal(starts.length,3,name+' must have three known migration revisions');
   const end=sql.indexOf('\n$$;',starts.at(-1));
   assert.ok(end>starts.at(-1),name+' final definition must terminate');
   const definition=sql.slice(starts.at(-1),end+4);
   assert.match(definition,/perform\s+public\.bridge_server_assert_tx_session\s*\(/i);
   assert.match(definition,/p_device_id\s*,\s*p_session_binding_hex/i);
   if(name==='bridge_server_claim_list'){
     assert.match(definition,/j\.operation\s*=\s*'list'/i);
   }else{
     assert.match(definition,/v_job\.operation\s*<>\s*'list'/i);
   }
 }
});

test('bundled staging migrations exactly match individual source files',()=>{
 const markers=[...sql.matchAll(/^-- ===== \d+\/(?:13|14): ([^\s]+) =====$/gm)];
 assert.equal(markers.length,14);
 for(let i=0;i<markers.length;i++){
   const start=markers[i].index+markers[i][0].length;
   const end=i+1<markers.length?markers[i+1].index:sql.lastIndexOf('\nCOMMIT;');
   const actual=sql.slice(start,end).trim();
   const source=readFileSync(new URL('./migrations/'+markers[i][1],import.meta.url),'utf8').trim();
   assert.equal(actual,source,'staging bundle drifted from '+markers[i][1]);
 }
});

test('all bundled Bridge function bodies have balanced PostgreSQL dollar delimiters',()=>{
 const definitions=[...sql.matchAll(/create\s+or\s+replace\s+function\s+public\.[a-z_]+\s*\(/gi)];
 assert.equal(definitions.length,27);
 for(let i=0;i<definitions.length;i++){
   const start=definitions[i].index;
   const end=i+1<definitions.length?definitions[i+1].index:sql.lastIndexOf('\nCOMMIT;');
   const part=sql.slice(start,end);
   const open=part.match(/\bas\s+(\$[a-z_0-9]*\$)\s*\n/i);
   assert.ok(open,'missing dollar-quoted function body near '+start);
   const tag=open[1];
   const at=part.indexOf(tag,part.indexOf(open[0])+open[0].length);
   assert.ok(at>=0,'unclosed function body near '+start);
   assert.match(part.slice(at+tag.length),/^\s*;/,'function terminator missing near '+start);
 }
});

test('production candidate matches the reviewed staging migration payload byte for byte',()=>{
 const production=readFileSync(new URL('./bridge_production_install_CANDIDATE_DO_NOT_RUN.sql',import.meta.url),'utf8');
 const marker='-- ===== 1/14: 20261106_bridge_foundation.sql =====';
 const stagingStart=sql.indexOf(marker);
 const productionStart=production.indexOf(marker);
 assert.ok(stagingStart>0 && productionStart>0);
 const stagingEnd=sql.lastIndexOf('\nCOMMIT;');
 const productionEnd=production.lastIndexOf('\nCOMMIT;');
 assert.ok(stagingEnd>stagingStart && productionEnd>productionStart);
 assert.equal(production.slice(productionStart,productionEnd),sql.slice(stagingStart,stagingEnd));
 assert.match(production,/PRODUCTION CANDIDATE -- NOT APPROVED FOR EXECUTION/);
 assert.match(production,/verified production backup/);
 assert.match(production,/BRIDGE STOP: existing Bridge objects/);
 assert.match(production,/BRIDGE STOP: missing production FreePT prerequisites/);
 assert.equal((production.match(/^-- ===== \d+\/(?:13|14):/gm)||[]).length,14);
 assert.ok(!production.includes('Database target: FreePT-Bridge-Test ONLY'));
});

test('production candidate has exactly one outer transaction and no destructive top-level operations',()=>{
 const production=readFileSync(new URL('./bridge_production_install_CANDIDATE_DO_NOT_RUN.sql',import.meta.url),'utf8');
 assert.equal((production.match(/^BEGIN;$/gm)||[]).length,1);
 assert.equal((production.match(/^COMMIT;$/gm)||[]).length,1);
 const beforeMigrations=production.slice(0,production.indexOf('-- ===== 1/14:'));
 assert.doesNotMatch(beforeMigrations,/\b(?:drop|truncate|delete|update|insert)\s+(?:table\s+|from\s+|into\s+)?public\./i);
});
