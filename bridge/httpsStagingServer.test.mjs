import test from 'node:test';
import assert from 'node:assert/strict';
import {createBridgeStagingHttpsService} from './httpsStagingServer.mjs';
const env={
  FREEPT_BRIDGE_STAGING:'I_UNDERSTAND_LOCAL_TEST_ONLY',
  FREEPT_BRIDGE_PUBLIC:'I_UNDERSTAND_STAGING_HTTPS_ONLY',
  FREEPT_BRIDGE_ALLOWED_ORIGINS:'https://localhost',
  FREEPT_BRIDGE_TEST_SUPABASE_URL:'https://freept-bridge-disposable-ci.supabase.co',
  FREEPT_BRIDGE_TEST_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_'+'a'.repeat(24),
  FREEPT_BRIDGE_TEST_SUPABASE_SERVICE_ROLE_KEY:'sb_secret_'+'b'.repeat(24),
  PORT:'10000'
};
test('public gateway refuses missing configuration and production Supabase',()=>{
  const never=()=>{throw Error('clients_must_not_be_constructed')};
  assert.throws(()=>createBridgeStagingHttpsService({
    env:{...env,FREEPT_BRIDGE_PUBLIC:''},createClientFn:never
  }),/bridge_gateway_opt_in_required/);
  assert.throws(()=>createBridgeStagingHttpsService({
    env:{...env,FREEPT_BRIDGE_STAGING:''},createClientFn:never
  }),/bridge_staging_explicit_opt_in_required/);
  assert.throws(()=>createBridgeStagingHttpsService({
    env:{...env,FREEPT_BRIDGE_TEST_SUPABASE_URL:'https://cpopqsvzzxfjgnlawlvc.supabase.co'},
    createClientFn:never
  }),/bridge_staging_url_invalid/);
});
test('separate client credentials never pass to the browser-facing gateway',()=>{
  const keys=[];
  const fakeClient=(url,key)=>{
    keys.push(key);
    if(keys.length===1)return {auth:{getUser:async()=>({data:{user:null}})}};
    return {from:()=>{},rpc:async()=>({data:null,error:{code:'not_configured'}})};
  };
  const server=createBridgeStagingHttpsService({env,createClientFn:fakeClient});
  assert.equal(keys.length,2);
  assert.equal(keys[0],env.FREEPT_BRIDGE_TEST_SUPABASE_PUBLISHABLE_KEY);
  assert.equal(keys[1],env.FREEPT_BRIDGE_TEST_SUPABASE_SERVICE_ROLE_KEY);
  assert.equal(typeof server.start,'function');
  assert.equal(typeof server.stop,'function');
  assert.equal(JSON.stringify(Object.keys(server)).includes(env.FREEPT_BRIDGE_TEST_SUPABASE_SERVICE_ROLE_KEY),false);
});
