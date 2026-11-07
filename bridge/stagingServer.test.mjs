import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBridgeStagingConfig,createBridgeStagingServer} from './stagingServer.mjs';

const good={
  FREEPT_BRIDGE_STAGING:'I_UNDERSTAND_LOCAL_TEST_ONLY',
  FREEPT_BRIDGE_TEST_SUPABASE_URL:'https://isolated-test-fixture.supabase.co',
  FREEPT_BRIDGE_TEST_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_'+'a'.repeat(24),
  FREEPT_BRIDGE_TEST_SUPABASE_SERVICE_ROLE_KEY:'sb_secret_'+'b'.repeat(24)
};
test('staging runtime fails closed unless explicitly opted in',()=>{
  assert.throws(()=>validateBridgeStagingConfig({}),/explicit_opt_in/);
  assert.throws(()=>validateBridgeStagingConfig({...good,FREEPT_BRIDGE_STAGING:''}),/explicit_opt_in/);
});
test('staging runtime rejects production, insecure URL and credential gaps',()=>{
  for(const url of [
    'https://cpopqsvzzxfjgnlawlvc.supabase.co',
    'http://isolated-test-fixture.supabase.co',
    'https://isolated-test-fixture.supabase.co/path',
    'https://isolated-test-fixture.supabase.co/?key=a',
    'https://attacker.test'
  ]) assert.throws(()=>validateBridgeStagingConfig({
    ...good,FREEPT_BRIDGE_TEST_SUPABASE_URL:url
  }),/staging_url_invalid/);
  assert.throws(()=>validateBridgeStagingConfig({
    ...good,FREEPT_BRIDGE_TEST_SUPABASE_SERVICE_ROLE_KEY:''
  }),/staging_credentials_invalid/);
});
test('valid isolated project configuration carries only expected fields',()=>{
  const config=validateBridgeStagingConfig(good);
  assert.equal(config.url,'https://isolated-test-fixture.supabase.co');
  assert.equal(Object.isFrozen(config),true);
  assert.deepEqual(Object.keys(config).sort(),['publishable','serviceKey','url']);
});
test('staging runtime builds separate public-auth and privileged clients',async()=>{
  const seen=[];
  const fakeClient=(url,key,options)=>{
    seen.push({url,key,options});
    if(seen.length===1)return {auth:{getUser:async()=>({data:{user:null},error:null})}};
    return {from:()=>{},rpc:async()=>({data:null,error:{code:'test_only'}})};
  };
  const server=createBridgeStagingServer({
    config:validateBridgeStagingConfig(good),createClientFn:fakeClient
  });
  assert.equal(seen.length,2);
  assert.equal(seen[0].key,good.FREEPT_BRIDGE_TEST_SUPABASE_PUBLISHABLE_KEY);
  assert.equal(seen[1].key,good.FREEPT_BRIDGE_TEST_SUPABASE_SERVICE_ROLE_KEY);
  assert.equal(seen[0].options.auth.persistSession,false);
  assert.equal(seen[1].options.auth.autoRefreshToken,false);
  const url=await server.start();
  try{
    assert.match(url,/^http:\/\/127\.0\.0\.1:\d+$/);
    const response=await fetch(url+'/bridge/admin/list',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({deviceId:'11111111-1111-4111-8111-111111111111'})
    });
    assert.equal(response.status,401);
  }finally{await server.stop();}
});

test('direct staging factory refuses unchecked or forged production configurations',()=>{
  const fakeClient=()=>{throw Error('should_not_create_clients')};
  for(const config of [
    {url:'https://cpopqsvzzxfjgnlawlvc.supabase.co',
     publishable:good.FREEPT_BRIDGE_TEST_SUPABASE_PUBLISHABLE_KEY,
     serviceKey:good.FREEPT_BRIDGE_TEST_SUPABASE_SERVICE_ROLE_KEY},
    {url:good.FREEPT_BRIDGE_TEST_SUPABASE_URL,
     publishable:good.FREEPT_BRIDGE_TEST_SUPABASE_PUBLISHABLE_KEY,
     serviceKey:good.FREEPT_BRIDGE_TEST_SUPABASE_SERVICE_ROLE_KEY},
    {...validateBridgeStagingConfig(good)},null
  ]) assert.throws(()=>createBridgeStagingServer({
    config,createClientFn:fakeClient
  }),/bridge_staging_dependencies_invalid/);
});
