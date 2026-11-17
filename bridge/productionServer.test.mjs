import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBridgeProductionConfig,createBridgeProductionService} from './productionServer.mjs';
const good={
  FREEPT_BRIDGE_PRODUCTION:'I_ACCEPT_PRODUCTION_BRIDGE',
  FREEPT_BRIDGE_PUBLIC:'I_ACCEPT_PRODUCTION_BRIDGE',
  FREEPT_BRIDGE_PRODUCTION_SUPABASE_URL:'https://cpopqsvzzxfjgnlawlvc.supabase.co',
  FREEPT_BRIDGE_PRODUCTION_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_'+'a'.repeat(24),
  FREEPT_BRIDGE_PRODUCTION_SUPABASE_SERVICE_ROLE_KEY:'sb_secret_'+'b'.repeat(24),
  FREEPT_BRIDGE_ALLOWED_ORIGINS:'https://localhost',
  PORT:'10000'
};
test('production fails closed without both explicit gates and credentials',()=>{
  const never=()=>{throw Error('client_must_not_be_created')};
  for(const patch of [
    {FREEPT_BRIDGE_PRODUCTION:''},{FREEPT_BRIDGE_PUBLIC:''},
    {FREEPT_BRIDGE_PRODUCTION_SUPABASE_URL:'https://freept-bridge-disposable-ci.supabase.co'},
    {FREEPT_BRIDGE_PRODUCTION_SUPABASE_URL:'http://cpopqsvzzxfjgnlawlvc.supabase.co'},
    {FREEPT_BRIDGE_PRODUCTION_SUPABASE_SERVICE_ROLE_KEY:''},
    {FREEPT_BRIDGE_ALLOWED_ORIGINS:'*'}
  ])assert.throws(()=>createBridgeProductionService({
    env:{...good,...patch},createClientFn:never
  }));
});
test('production creates isolated server clients only after validation',()=>{
  const keys=[];
  const fake=(url,key)=>{
    keys.push([url,key]);
    if(keys.length===1)return {auth:{getUser:async()=>({data:{user:null}})}};
    return {from:()=>{},rpc:async()=>({data:null,error:{code:'test'}})};
  };
  const service=createBridgeProductionService({env:good,createClientFn:fake});
  assert.equal(keys.length,2);
  assert.equal(keys[0][1],good.FREEPT_BRIDGE_PRODUCTION_SUPABASE_PUBLISHABLE_KEY);
  assert.equal(keys[1][1],good.FREEPT_BRIDGE_PRODUCTION_SUPABASE_SERVICE_ROLE_KEY);
  assert.equal(typeof service.start,'function');
  assert.equal(typeof service.stop,'function');
  assert.equal(validateBridgeProductionConfig(good).url,good.FREEPT_BRIDGE_PRODUCTION_SUPABASE_URL);
});

test('production accepts only exact Android Capacitor localhost origin',()=>{
  const android={...good,FREEPT_BRIDGE_ALLOWED_ORIGINS:'http://localhost'};
  assert.deepEqual(validateBridgeProductionConfig(android).http.origins,['http://localhost','https://localhost']);
  assert.deepEqual(validateBridgeProductionConfig(good).http.origins,['https://localhost','http://localhost']);
  for(const origin of ['http://localhost:8080','http://127.0.0.1','http://evil.example','http://localhost.evil.example']){
    assert.throws(()=>validateBridgeProductionConfig({...good,FREEPT_BRIDGE_ALLOWED_ORIGINS:origin}),/bridge_gateway_origins_invalid/);
  }
});
