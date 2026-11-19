import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,verify} from 'node:crypto';
import {derSignature,fixtureBytes} from './test-console/protocol.mjs';
import {bootstrapBytes} from './bootstrapProtocol.mjs';
import {stagingTestConsoleAssets,TEST_CONSOLE_ORIGIN} from './stagingTestConsole.mjs';
import {createBridgeHttpsGateway} from './httpsGateway.mjs';
const db={url:'https://aqjuixbuxftnjfzxmzuj.supabase.co',publishable:'sb_publishable_test_only_public_key',serviceKey:'NEVER_EXPOSE_SERVICE_SECRET'};
const env={FREEPT_BRIDGE_TEST_CONSOLE:'AUTH_E2E_ONLY',FREEPT_BRIDGE_BOOTSTRAP:'STAGING_DEVICE_KEY_V1'};
test('test console requires explicit gate, bootstrap and exact test project',()=>{
 assert.equal(stagingTestConsoleAssets({},db),null);
 assert.throws(()=>stagingTestConsoleAssets({...env,FREEPT_BRIDGE_BOOTSTRAP:''},db),/isolated_bootstrap/);
 for(const url of ['https://cpopqsvzzxfjgnlawlvc.supabase.co','https://another.supabase.co'])assert.throws(()=>stagingTestConsoleAssets(env,{...db,url}),/isolated_bootstrap/);
 const assets=stagingTestConsoleAssets(env,db);
 assert.equal(assets.size,4);
 for(const a of assets.values()){assert.ok(!a.body.includes(db.serviceKey));assert.ok(a.csp.includes("frame-ancestors 'none'"));assert.ok(!a.csp.includes('unsafe-inline'));}
 assert.ok(assets.get('/test/config.mjs').body.includes(db.publishable));
});
test('browser P256 signature conversion verifies with server-compatible DER',()=>{
 const keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),message=Buffer.from('freept-test');
 for(let i=0;i<64;i++){
  const raw=sign('sha256',message,{key:keys.privateKey,dsaEncoding:'ieee-p1363'});
  assert.equal(verify('sha256',message,keys.publicKey,derSignature(raw)),true);
 }
 assert.throws(()=>derSignature(new Uint8Array(63)));
});
test('browser synthetic bytes exactly match server across both chunks',()=>{
 const challenge='17'.repeat(32);
 for(const [offset,length] of [[0,262144],[262144,37856]])assert.deepEqual(Buffer.from(fixtureBytes(challenge,offset,length)),bootstrapBytes(challenge,offset,length));
});
test('console routes remain HTTPS-only, uncached and absent unless explicitly installed',async()=>{
 const denied=async()=>({status:403,body:{error:'denied'}});
 for(const enabled of [false,true]){
  const gateway=createBridgeHttpsGateway({admin:denied,owner:denied,tx:denied,bootstrap:denied,config:{origins:[TEST_CONSOLE_ORIGIN]},staticAssets:enabled?stagingTestConsoleAssets(env,db):null});
  const address=await gateway.start();const url='http://127.0.0.1:'+address.port;
  try{
   let r=await fetch(url+'/test/');assert.equal(r.status,403);
   r=await fetch(url+'/test/',{headers:{'x-forwarded-proto':'https'}});assert.equal(r.status,enabled?200:404);
   if(enabled){assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('x-frame-options'),'DENY');assert.ok((await r.text()).includes('Password amministratore TEST'));}
   r=await fetch(url+'/test/config.mjs',{headers:{'x-forwarded-proto':'https',origin:'https://evil.invalid'}});assert.equal(r.status,403);
  }finally{await gateway.stop();}
 }
});
