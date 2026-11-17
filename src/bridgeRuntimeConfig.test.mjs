import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveBridgeRuntimeConfig} from './bridgeRuntimeConfig.js';
const staging='https://bridge-staging.example.org';
const production='https://bridge.example.org';
test('ordinary FreePT build does not enable native Bridge',()=>{
  assert.deepEqual(resolveBridgeRuntimeConfig(),{enabled:false,baseUrl:null});
});
test('isolated and production builds resolve their own HTTPS endpoint',()=>{
  assert.equal(resolveBridgeRuntimeConfig({isolated:true,testApiUrl:staging}).baseUrl,staging);
  assert.equal(resolveBridgeRuntimeConfig({production:true,productionApiUrl:production}).baseUrl,production);
});
test('Bridge refuses cross-environment and insecure configuration',()=>{
  for(const options of [
    {isolated:true,production:true,testApiUrl:staging},
    {production:true,testApiUrl:staging,productionApiUrl:production},
    {isolated:true,testApiUrl:staging,productionApiUrl:production},
    {production:true,productionApiUrl:'http://bridge.example.org'},
    {production:true},
    {isolated:true}
  ])assert.throws(()=>resolveBridgeRuntimeConfig(options));
});
