import test from 'node:test';
import assert from 'node:assert/strict';
import {configureNativeUpdater} from './nativeConfig.mjs';
const base={appId:'it.freept.app',appName:'FreePT',webDir:'dist',android:{allowMixedContent:false}};
test('OTA disabled by default without touching app identity',()=>{
  const result=configureNativeUpdater(base);
  assert.equal(result.appId,base.appId);
  assert.equal(result.plugins.CapacitorUpdater.autoUpdate,'off');
  assert.equal(result.plugins.CapacitorUpdater.updateUrl,undefined);
  assert.equal(base.plugins,undefined);
});
test('only explicit HTTPS endpoint enables background OTA',()=>{
  const result=configureNativeUpdater(base,{
    enable:'I_ACCEPT_FREEPT_OTA',url:'https://ota.example.org/updates'
  });
  assert.equal(result.plugins.CapacitorUpdater.autoUpdate,'atBackground');
  assert.equal(result.plugins.CapacitorUpdater.updateUrl,'https://ota.example.org/updates');
  assert.equal(result.plugins.CapacitorUpdater.allowModifyUrl,false);
});
test('reject missing opt-in, non-HTTPS, Supabase host, port and unsafe app ID',()=>{
  for(const url of ['http://ota.example.org/updates',
    'https://cpopqsvzzxfjgnlawlvc.supabase.co/updates',
    'https://ota.example.org:1234/updates',
    'https://ota.example.org/admin',
    'https://user:pass@ota.example.org/updates',
    'https://ota.example.org/updates?test=1'])
    assert.throws(()=>configureNativeUpdater(base,{enable:'I_ACCEPT_FREEPT_OTA',url}),/invalid/);
  assert.throws(()=>configureNativeUpdater(base,{url:'https://ota.example.org/updates'}),/opt_in/);
  assert.throws(()=>configureNativeUpdater({...base,appId:'it.freept.bridge.next'}),/mismatch/);
});
