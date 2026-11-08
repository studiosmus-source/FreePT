import test from 'node:test';
import assert from 'node:assert/strict';
import {getFreePtSupabaseConfig} from '../src/supabaseConfig.js';

const production='https://cpopqsvzzxfjgnlawlvc.supabase.co';
const testUrl='https://isolated-ci.supabase.co';
const testKey='sb_publishable_'+'a'.repeat(24);

test('normal FreePT still supports its existing production fallback',()=>{
 const config=getFreePtSupabaseConfig();
 assert.equal(config.url,production);
 assert.equal(config.key.startsWith('sb_publishable_'),true);
});
test('experimental Bridge build refuses missing configuration',()=>{
 for(const props of [{},{url:testUrl},{key:testKey}]){
  assert.throws(()=>getFreePtSupabaseConfig({...props,isolated:true}),
   /isolated_supabase_/);
 }
});
test('experimental Bridge build rejects production and unsafe Supabase URLs',()=>{
 for(const url of [production,'http://isolated-ci.supabase.co',
   'https://isolated-ci.supabase.co/path',
   'https://isolated-ci.supabase.co/?q=1',
   'https://evil.test','https://isolated-ci.supabase.co.evil.test',
   'https://u:p@isolated-ci.supabase.co']){
  assert.throws(()=>getFreePtSupabaseConfig({
   isolated:true,url,key:testKey
  }),/isolated_supabase_url_required/);
 }
});
test('experimental Bridge build rejects missing and unsuitable publishable keys',()=>{
 for(const key of ['',undefined,'bad','sb_secret_'+'b'.repeat(24)]){
  assert.throws(()=>getFreePtSupabaseConfig({
   isolated:true,url:testUrl,key
  }),/isolated_supabase_key_required/);
 }
});
test('experimental Bridge accepts distinct test project only',()=>{
 const config=getFreePtSupabaseConfig({
  isolated:true,url:testUrl,key:testKey
 });
 assert.equal(config.url,testUrl);
 assert.equal(config.key,testKey);
 assert.equal(Object.isFrozen(config),true);
});
