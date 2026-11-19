import test from 'node:test';
import assert from 'node:assert/strict';
import {createChieditore} from './chieditore.js';
function setup(){
 const calls=[];let files=false,notify=false,verified=false,offline=false;
 const c=createChieditore({files:{status:async()=>({granted:files}),requestPermission:async()=>{calls.push('files');files=true;}},
 notifications:{checkPermissions:async()=>({receive:notify?'granted':'prompt'}),requestPermissions:async()=>{calls.push('notify');notify=true;}},
 native:{battery:async()=>({unrestricted:true}),begin:async()=>{calls.push('begin');return {pairCode:'abcdef123456'}},status:async()=>{if(offline)throw Error('offline');return {verified};},shareReport:async data=>{calls.push(data);}},
 tx:{start:async()=>calls.push('start'),stop:async()=>calls.push('stop')}});
 return {c,calls,verify:()=>verified=true,revoke:()=>verified=false,offline:()=>offline=true};
}
test('permissions are sequential; no personal session or token registration occurs',async()=>{
 const f=setup();assert.equal(await f.c.canRegister(),false);
 assert.equal((await f.c.next()).step,'notifications');
 assert.equal((await f.c.next()).step,'battery');
 assert.equal((await f.c.next()).step,'bridge');
 assert.deepEqual(f.calls,['files','notify']);
 const s=await f.c.next();assert.equal(s.verified,false);assert.deepEqual(f.calls,['files','notify','begin','start']);
 assert.equal(await f.c.canRegister(),false);f.verify();await f.c.next();assert.equal(await f.c.canRegister(),true);
});
test('a successful permission Activity result cannot override the actual state',async()=>{
 const c=createChieditore({files:{status:async()=>({granted:false}),requestPermission:async()=>({granted:true})}});
 const s=await c.next();assert.equal(s.step,'files');assert.equal(s.state,'denied');
});
test('already granted permissions are not requested again',async()=>{
 let prompts=0;const c=createChieditore({files:{status:async()=>({granted:true}),requestPermission:async()=>prompts++},
 notifications:{checkPermissions:async()=>({receive:'granted'}),requestPermissions:async()=>prompts++}});
 await c.next();await c.next();assert.equal(prompts,0);
});
test('reentry is single-flight and closing an unverified run stops TX',async()=>{
 const f=setup();await Promise.all([f.c.next(),f.c.next()]);assert.deepEqual(f.calls,['files']);
 await f.c.dispose();assert.equal(f.calls.at(-1),'stop');await assert.rejects(f.c.next(),/closed/);
});
test('backend revocation and network failure prevent close-to-registration',async()=>{
 const f=setup();for(let i=0;i<4;i++)await f.c.next();f.verify();await f.c.next();
 assert.equal(await f.c.canRegister(),true);
 f.revoke();assert.equal(await f.c.canRegister(),false);
 f.verify();f.offline();assert.equal(await f.c.canRegister(),false);
});
test('report contains only stage enums and relative timings, never pairing code',async()=>{
 const f=setup();for(let i=0;i<4;i++)await f.c.next();await f.c.report();
 const report=f.calls.at(-1);assert.equal(JSON.stringify(report).includes('abcdef123456'),false);
 assert.ok(report.stages.every(x=>Object.keys(x).sort().join(',')==='elapsedMs,stage,state'));
});
test('closing while enrollment is in flight cannot start a late background service',async()=>{
 let release,starts=0;
 const waiting=new Promise(resolve=>release=resolve);
 const c=createChieditore({files:{status:async()=>({granted:true})},notifications:{checkPermissions:async()=>({receive:'granted'})},
 native:{battery:async()=>({unrestricted:true}),begin:async()=>{await waiting;return {pairCode:'abcdef123456'}}},
 tx:{start:async()=>starts++,stop:async()=>{}}});
 await c.next();await c.next();await c.next();
 const pending=c.next();await c.dispose();release();await assert.rejects(pending,/closed/);assert.equal(starts,0);
});
