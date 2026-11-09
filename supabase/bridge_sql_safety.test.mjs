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
