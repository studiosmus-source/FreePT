import test from 'node:test';
import assert from 'node:assert/strict';
import {installWindowsBridgeEnrollment} from './windowsBridgeEnrollment.js';
function setup(host='app.freept.test'){
  let listener=null;const sent=[];
  globalThis.window={location:{hostname:host},chrome:{webview:{
    addEventListener:(type,cb)=>{if(type==='message')listener=cb;},
    postMessage:value=>sent.push(value)
  }}};
  return {get listener(){return listener;},sent};
}
test('windows session is shared only for an explicit native nonce and approved user',async()=>{
 const bridge=setup();
 installWindowsBridgeEnrollment({
   auth:{getSession:async()=>({data:{session:{user:{id:'owner-id'},access_token:'x'.repeat(40)}}})},
   getIdentity:()=>({id:'owner-id',role:'user',status:'approved'})
 });
 assert.equal(typeof bridge.listener,'function');
 await bridge.listener({data:{kind:'freept_win_pair_request',nonce:'a'.repeat(32)}});
 assert.deepEqual(bridge.sent,[{kind:'freept_win_pair_response',nonce:'a'.repeat(32),accessToken:'x'.repeat(40)}]);
 delete globalThis.window;
});
test('windows refuses pairing without approval or on invalid request',async()=>{
 const bridge=setup();
 installWindowsBridgeEnrollment({auth:{getSession:async()=>{throw Error('should not be used')}},
   getIdentity:()=>({id:'pending',role:'user',status:'pending'})});
 await bridge.listener({data:{kind:'irrelevant',nonce:'a'.repeat(32)}});
 await bridge.listener({data:{kind:'freept_win_pair_request',nonce:'invalid'}});
 assert.equal(bridge.sent.length,0);
 await bridge.listener({data:{kind:'freept_win_pair_request',nonce:'b'.repeat(32)}});
 assert.deepEqual(bridge.sent,[{kind:'freept_win_pair_response',nonce:'b'.repeat(32),accessToken:null}]);
 delete globalThis.window;
});
test('normal browser and Android do not install Windows-only handoff',()=>{
 const bridge=setup('other.example');
 installWindowsBridgeEnrollment({auth:{},getIdentity:()=>null});
 assert.equal(bridge.listener,null);
 delete globalThis.window;
});
