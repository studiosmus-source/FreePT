import test from 'node:test';
import assert from 'node:assert/strict';
import {createOtaServer} from './server.mjs';
import {validateRelease} from './releaseProtocol.mjs';
const stable=validateRelease({
  enabled:true,version:'1.0.1',nativeVersionCode:1,
  url:'https://github.com/studiosmus-source/FreePT/releases/download/v1.0.1/FreePT-web.zip',
  checksum:'b'.repeat(64)
});
async function withServer(handler){
  const server=createOtaServer({stable,allowLocalHttp:true});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{return await handler('http://127.0.0.1:'+server.address().port);}
  finally{await new Promise(resolve=>server.close(resolve));}
}
test('health is read-only and outside update route',async()=>{
  await withServer(async url=>{
    const health=await fetch(url+'/health');
    assert.deepEqual(await health.json(),{status:'ok'});
    assert.equal((await fetch(url+'/missing')).status,404);
  });
});
test('returns authenticated-by-native-compatibility release metadata, not secrets',async()=>{
  await withServer(async url=>{
    const response=await fetch(url+'/updates',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({
        app_id:'it.freept.app',platform:'android',device_id:'device-123456',
        version_code:'1',version_name:'builtin'
      })
    });
    assert.equal(response.status,200);
    const result=await response.json();
    assert.equal(result.version,'1.0.1');
    assert.deepEqual(Object.keys(result).sort(),['checksum','url','version']);
  });
});
test('Capgo no-update response uses the documented error contract',async()=>{
  await withServer(async url=>{
    const response=await fetch(url+'/updates',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({app_id:'it.freept.app',platform:'android',
        device_id:'device-123456',version_code:'8',version_name:'builtin'})
    });
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{
      error:'no_new_version_available',message:'No new version available'
    });
  });
});
test('bad requests are rejected without modifying state',async()=>{
  await withServer(async url=>{
    const html=await fetch(url+'/updates',{method:'POST',headers:{'content-type':'text/plain'},body:'{}'});
    assert.equal(html.status,415);
    const malformed=await fetch(url+'/updates',{method:'POST',
      headers:{'content-type':'application/json'},body:'{oops'});
    assert.equal(malformed.status,400);
    const oversized=await fetch(url+'/updates',{method:'POST',
      headers:{'content-type':'application/json'},body:JSON.stringify({x:'x'.repeat(5000)})});
    assert.equal(oversized.status,413);
  });
});
test('TLS is mandatory for public update checks',async()=>{
  const server=createOtaServer({stable});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const response=await fetch('http://127.0.0.1:'+server.address().port+'/updates',{
      method:'POST',headers:{'content-type':'application/json'},body:'{}'
    });
    assert.equal(response.status,403);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
