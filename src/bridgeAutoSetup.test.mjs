import test from 'node:test';
import assert from 'node:assert/strict';
import {createBridgeAutoSetup} from './bridgeAutoSetup.js';
function fixture(options={}){
 const calls=[];
 let user={id:'owner',role:'user',status:'approved'};
 const c=createBridgeAutoSetup({
  native:{localStatus:async()=>({initialized:true,bound:false,...options.local}),
   finishOwnerEnrollment:async()=>calls.push('finish')},
  files:{status:async()=>({granted:options.permission!==false})},
  tx:{status:async()=>({paused:options.paused}),start:async()=>calls.push('start')},
  owner:{enroll:async()=>{calls.push('enroll');if(options.onEnroll)await options.onEnroll(()=>{user=null;});return {deviceId:'device'};}},
  controls:{activateFamily:async()=>{calls.push('grant');if(options.failGrant)throw Error('offline');}},
  getUser:()=>options.pending?{...user,status:'pending'}:user
 });
 return {c,calls};
}
test('existing consent continues enrollment and grant before starting real file TX',async()=>{
 const f=fixture();await f.c.run();assert.deepEqual(f.calls,['enroll','grant','finish','start']);
});
test('no prompts or grants for missing consent, revoked permission or bound devices',async()=>{
 for(const options of [{local:{initialized:false}},{permission:false},{local:{bound:true}},{pending:true}]){
  const f=fixture(options);await f.c.run();assert.deepEqual(f.calls,[]);
 }
});
test('repair the old consent-screen stop flag only before account binding',async()=>{
 const f=fixture({paused:true});await f.c.run();assert.deepEqual(f.calls,['start','enroll','grant','finish','start']);
 const bound=fixture({paused:true,local:{bound:true}});await bound.c.run();assert.deepEqual(bound.calls,[]);
});
test('failed grant is retryable and never switches to file access',async()=>{
 const f=fixture({failGrant:true});await assert.rejects(f.c.run(),/offline/);
 assert.deepEqual(f.calls,['enroll','grant']);
 await assert.rejects(f.c.run(),/offline/);assert.equal(f.calls.filter(x=>x==='enroll').length,2);
});
test('account switching during enrollment stops before granting access',async()=>{
 const f=fixture({onEnroll:async logout=>logout()});await f.c.run();assert.deepEqual(f.calls,['enroll']);
});
test('simultaneous render and resume share one enrollment',async()=>{
 const f=fixture();await Promise.all([f.c.run(),f.c.run()]);assert.deepEqual(f.calls,['enroll','grant','finish','start']);
});
