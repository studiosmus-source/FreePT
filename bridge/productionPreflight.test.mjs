import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectProductionEnvironment} from './productionPreflight.mjs';
const env={
 FREEPT_BRIDGE_PRODUCTION:'I_ACCEPT_PRODUCTION_BRIDGE',
 FREEPT_BRIDGE_PUBLIC:'I_ACCEPT_PRODUCTION_BRIDGE',
 FREEPT_BRIDGE_PRODUCTION_SUPABASE_URL:'https://cpopqsvzzxfjgnlawlvc.supabase.co',
 FREEPT_BRIDGE_PRODUCTION_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_'+'a'.repeat(24),
 FREEPT_BRIDGE_PRODUCTION_SUPABASE_SERVICE_ROLE_KEY:'sb_secret_'+'b'.repeat(24),
 FREEPT_BRIDGE_ALLOWED_ORIGINS:'https://localhost',PORT:'10000'
};
test('preflight reports missing configuration by name, not by secret value',()=>{
 const result=inspectProductionEnvironment({});
 assert.equal(result.ready,false);
 assert.ok(result.missing.includes('FREEPT_BRIDGE_PRODUCTION_SUPABASE_SERVICE_ROLE_KEY'));
 assert.equal(JSON.stringify(result).includes('sb_secret_'),false);
});
test('preflight rejects staging origin and accepts structurally valid production config',()=>{
 assert.deepEqual(inspectProductionEnvironment(env),{ready:true,missing:[],reason:null});
 const result=inspectProductionEnvironment({...env,FREEPT_BRIDGE_PRODUCTION_SUPABASE_URL:'https://staging.supabase.co'});
 assert.equal(result.ready,false);
 assert.equal(result.reason,'bridge_production_url_invalid');
});
