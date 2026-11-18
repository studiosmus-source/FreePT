import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createOtaServer} from './server.mjs';
import {validateApkRelease} from './apkReleaseProtocol.mjs';

const GOOD='https://github.com/studiosmus-source/FreePT/releases/download/apk-v2.0.0/FreePT.apk';
const apkStable=validateApkRelease({enabled:true,versionName:'2.0.0',versionCode:7,url:GOOD,sha256:'b'.repeat(64),minSdkInt:26});

function call(server,path,body){
  return new Promise((resolve,reject)=>{
    server.listen(0,'127.0.0.1',()=>{
      const {port}=server.address();
      const data=body===undefined?undefined:JSON.stringify(body);
      const req=http.request({host:'127.0.0.1',port,path,method:'POST',
        headers:{'content-type':'application/json'}},res=>{
        let b='';res.on('data',c=>b+=c);res.on('end',()=>{server.close();resolve({status:res.statusCode,json:b?JSON.parse(b):null});});
      });
      req.on('error',reject);
      if(data)req.write(data);req.end();
    });
  });
}
test('/apk-update offers higher versionCode',async()=>{
  const r=await call(createOtaServer({apkStable,allowLocalHttp:true}),'/apk-update',
    {platform:'android',app_id:'it.freept.app',device_id:'dev-123456',version_code:5,version_name:'1.9.0',sdk_int:34});
  assert.equal(r.status,200);assert.equal(r.json.versionCode,7);assert.equal(r.json.url,GOOD);
});
test('/apk-update refuses downgrade/equal',async()=>{
  const r=await call(createOtaServer({apkStable,allowLocalHttp:true}),'/apk-update',
    {platform:'android',app_id:'it.freept.app',device_id:'dev-123456',version_code:7,version_name:'2.0.0',sdk_int:34});
  assert.equal(r.json.error,'no_new_version_available');
});
test('web channel /updates untouched',async()=>{
  const r=await call(createOtaServer({apkStable,allowLocalHttp:true}),'/updates',
    {platform:'android',app_id:'it.freept.app',device_id:'dev-123456',version_name:'1.0.0',version_code:1});
  assert.equal(r.status,200);assert.equal(r.json.error,'no_new_version_available');
});
test('unknown route 404',async()=>{
  const r=await call(createOtaServer({apkStable,allowLocalHttp:true}),'/nope',{});
  assert.equal(r.status,404);
});
