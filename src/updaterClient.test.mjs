import test from 'node:test';
import assert from 'node:assert/strict';
import {createUpdaterClient} from './updaterClient.js';

const GOOD='https://github.com/studiosmus-source/FreePT/releases/download/apk-v1.2.0/FreePT.apk';
const SHA='a'.repeat(64);
const okResp={available:true,versionName:'1.2.0',versionCode:5,url:GOOD,sha256:SHA};

function plugin(over={}){
  return {check:async()=>okResp,download:async()=>({ready:true,path:'/x/updates/freept-5.apk'}),
    install:async()=>({launched:true}),addListener:async()=>({remove(){}}),...over};
}

test('check returns validated descriptor',async()=>{
  const u=createUpdaterClient({plugin:plugin()});
  assert.deepEqual(await u.check(),{versionName:'1.2.0',versionCode:5,url:GOOD,sha256:SHA});
});
test('check rejects foreign url, bad sha, bad semver, missing fields',async()=>{
  for(const bad of [
    {...okResp,url:'https://evil.example/x.apk'},
    {...okResp,url:GOOD.replace('.apk','.zip')},
    {...okResp,sha256:'zzz'},
    {...okResp,versionName:'1.2'},
    {...okResp,versionCode:0},
    {available:false}
  ]) assert.equal(await createUpdaterClient({plugin:plugin({check:async()=>bad})}).check(),null);
});
test('check swallows plugin errors as null',async()=>{
  assert.equal(await createUpdaterClient({plugin:plugin({check:async()=>{throw Error('x')}})}).check(),null);
});
test('downloadAndInstall drives download then install and reports progress',async()=>{
  const calls=[];const pcts=[];
  const p=plugin({
    download:async a=>{calls.push(['download',a]);return {ready:true,path:'/x/updates/freept-5.apk'};},
    install:async a=>{calls.push(['install',a]);return {launched:true};},
    addListener:async(ev,cb)=>{cb({percent:50});return {remove(){}};}
  });
  const u=createUpdaterClient({plugin:p});
  const out=await u.downloadAndInstall({url:GOOD,sha256:SHA,versionCode:5},{onProgress:x=>pcts.push(x)});
  assert.deepEqual(out,{launched:true});
  assert.equal(calls[0][0],'download');assert.equal(calls[1][0],'install');
  assert.equal(calls[1][1].path,'/x/updates/freept-5.apk');
  assert.deepEqual(pcts,[50]);
});
test('downloadAndInstall refuses tampered update object',async()=>{
  const u=createUpdaterClient({plugin:plugin()});
  await assert.rejects(()=>u.downloadAndInstall({url:'https://evil/x.apk',sha256:SHA,versionCode:5}),/updater_invalid_update/);
});
test('downloadAndInstall throws when native download not ready',async()=>{
  const u=createUpdaterClient({plugin:plugin({download:async()=>({ready:false})})});
  await assert.rejects(()=>u.downloadAndInstall({url:GOOD,sha256:SHA,versionCode:5}),/updater_download_not_ready/);
});
