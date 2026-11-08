import test from 'node:test';
import assert from 'node:assert/strict';
import {createBridgeHttpsGateway,validateBridgeGatewayConfig} from './httpsGateway.mjs';
const ORIGIN='https://localhost';
const CONFIG={origins:[ORIGIN]};
function fixture(){
  const calls=[];
  const handler=(kind)=>async req=>{
    calls.push({kind,...req});
    return {status:200,body:{kind,received:true}};
  };
  const gateway=createBridgeHttpsGateway({
    admin:handler('admin'),owner:handler('owner'),tx:handler('tx'),
    config:CONFIG,allowHttpInUnitTests:true
  });
  return {calls,gateway};
}
async function invoke(url,path,{method='POST',origin=ORIGIN,body={deviceId:'test'},
  authorization='Bearer '+ 'x'.repeat(40),headers={}}={}){
  const h={'content-type':'application/json',
    ...(origin!==null?{origin}:{}),
    ...(authorization?{authorization}:{}),...headers};
  const response=await fetch(url+path,{
    method,headers:h,
    ...(method==='POST'?{body:JSON.stringify(body)}:{})
  });
  const payload=response.status===204?null:await response.json();
  return {status:response.status,payload,headers:response.headers};
}
test('public deployment configuration refuses insecure origins and missing opt-in',()=>{
  const good={
    FREEPT_BRIDGE_PUBLIC:'I_UNDERSTAND_STAGING_HTTPS_ONLY',
    FREEPT_BRIDGE_ALLOWED_ORIGINS:ORIGIN,
    PORT:'10000'
  };
  assert.deepEqual(validateBridgeGatewayConfig(good),{origins:[ORIGIN],port:10000});
  for(const env of [
    {...good,FREEPT_BRIDGE_PUBLIC:''},
    {...good,FREEPT_BRIDGE_ALLOWED_ORIGINS:'*'},
    {...good,FREEPT_BRIDGE_ALLOWED_ORIGINS:'http://localhost'},
    {...good,FREEPT_BRIDGE_ALLOWED_ORIGINS:'https://localhost,https://localhost'},
    {...good,FREEPT_BRIDGE_ALLOWED_ORIGINS:'https://localhost/folder'},
    {...good,FREEPT_BRIDGE_ALLOWED_ORIGINS:'https://localhost?token=1'},
    {...good,PORT:'0'}
  ])assert.throws(()=>validateBridgeGatewayConfig(env));
});
test('strict routes select independently authenticated handler, never general relay',async t=>{
  const f=fixture();
  const address=await f.gateway.start();
  t.after(()=>f.gateway.stop());
  const url='http://127.0.0.1:'+address.port;
  assert.equal((await invoke(url,'/bridge/admin/list')).payload.kind,'admin');
  assert.equal((await invoke(url,'/bridge/owner/enroll')).payload.kind,'owner');
  assert.equal((await invoke(url,'/bridge/tx/folder')).payload.kind,'tx');
  assert.equal(f.calls.length,3);
  assert.equal((await invoke(url,'/bridge/secret')).status,404);
  assert.equal((await invoke(url,'/bridge/admin/list',{method:'GET'})).status,405);
  assert.equal(f.calls.length,3);
  assert.equal(f.calls[0].headers.authorization,'Bearer '+ 'x'.repeat(40));
});
test('reject browser origins except exact HTTPS Android origin',async t=>{
  const f=fixture();
  const address=await f.gateway.start();
  t.after(()=>f.gateway.stop());
  const url='http://127.0.0.1:'+address.port;
  assert.equal((await invoke(url,'/bridge/owner/enroll',{origin:'https://evil.example'})).status,403);
  const allowed=await invoke(url,'/bridge/owner/enroll');
  assert.equal(allowed.headers.get('access-control-allow-origin'),ORIGIN);
  assert.equal(f.calls.length,1);
  const preflight=await invoke(url,'/bridge/tx/folder',{method:'OPTIONS'});
  assert.equal(preflight.status,204);
  assert.equal(f.calls.length,1);
  assert.equal((await invoke(url,'/bridge/admin/list',{origin:null})).status,200);
});
test('no plain HTTP permitted without test-only override',async t=>{
  const gateway=createBridgeHttpsGateway({
    admin:async()=>({status:200,body:{ok:true}}),
    tx:async()=>({status:200,body:{ok:true}}),
    owner:async()=>({status:200,body:{ok:true}}),
    config:CONFIG
  });
  const address=await gateway.start();
  t.after(()=>gateway.stop());
  const url='http://127.0.0.1:'+address.port;
  assert.equal((await invoke(url,'/bridge/admin/list')).status,403);
  const forwarded=await invoke(url,'/bridge/admin/list',{headers:{'x-forwarded-proto':'https'}});
  assert.equal(forwarded.status,200);
});
test('bounded JSON and origin fail closed without handler execution',async t=>{
  const f=fixture();
  const address=await f.gateway.start();
  t.after(()=>f.gateway.stop());
  const url='http://127.0.0.1:'+address.port;
  assert.equal((await invoke(url,'/bridge/admin/list',{body:{padding:'x'.repeat(3000)}})).status,413);
  assert.equal((await invoke(url,'/bridge/tx/folder',{body:{padding:'x'.repeat(32000)}})).status,200);
  assert.equal((await invoke(url,'/bridge/tx/folder',{body:{padding:'x'.repeat(34000)}})).status,413);
  assert.equal(f.calls.length,1);
  const raw=await fetch(url+'/bridge/admin/list',{
    method:'POST',headers:{origin:ORIGIN,'content-type':'text/plain'},body:'hello'
  });
  assert.equal(raw.status,415);
  assert.equal(f.calls.length,1);
});
