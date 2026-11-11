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

test('staging HTTP admin boundary verifies live token before privileged RPC',async()=>{
  const ADMIN='22222222-2222-4222-8222-222222222222';
  const DEVICE='11111111-1111-4111-8111-111111111111';
  const ACCESS='t'.repeat(40);
  const calls=[];
  const fakeClient=(url,key)=>{
    if(key===good.FREEPT_BRIDGE_TEST_SUPABASE_PUBLISHABLE_KEY)
      return {auth:{async getUser(token){
        calls.push('verify');
        return {data:{user:token===ACCESS?{id:ADMIN,is_anonymous:false}:null},error:null};
      }}};
    if(key!==good.FREEPT_BRIDGE_TEST_SUPABASE_SERVICE_ROLE_KEY)
      throw Error('wrong_test_key');
    return {
      from(table){
        if(table!=='profiles')throw Error('unexpected_table');
        return {select(columns){
          assert.equal(columns,'id,role,status');
          return {eq(column,id){
            assert.equal(column,'id');assert.equal(id,ADMIN);
            return {async maybeSingle(){
              calls.push('role_check');
              return {data:{id:ADMIN,role:'admin',status:'approved'},error:null};
            }};
          }};
        }};
      },
      async rpc(name,args){
        calls.push(name);
        if(name!=='bridge_server_enqueue_list')throw Error('unexpected_rpc');
        assert.equal(args.p_device_id,DEVICE);
        assert.equal(args.p_receiver_id,ADMIN);
        return {data:args.p_job_id,error:null};
      }
    };
  };
  const server=createBridgeStagingServer({
    config:validateBridgeStagingConfig(good),createClientFn:fakeClient
  });
  const url=await server.start();
  const request=async authorization=>{
    const response=await fetch(url+'/bridge/admin/list',{
      method:'POST',
      headers:{'content-type':'application/json',
        ...(authorization?{authorization} :{})},
      body:JSON.stringify({deviceId:DEVICE})
    });
    return {status:response.status,body:await response.json()};
  };
  try{
    assert.equal((await request(null)).status,401);
    assert.deepEqual(calls,[]);
    assert.equal((await request('Bearer '+'x'.repeat(40))).status,403);
    assert.deepEqual(calls,['verify']);
    const ok=await request('Bearer '+ACCESS);
    assert.equal(ok.status,202);
    assert.equal(ok.body.deviceId,DEVICE);
    assert.equal(ok.body.state,'queued');
    assert.match(ok.body.jobId,/^[0-9a-f-]{36}$/);
    assert.deepEqual(calls.slice(-3),['verify','role_check','bridge_server_enqueue_list']);
  }finally{await server.stop();}
});
