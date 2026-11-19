import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createChieditore} from './chieditore.js';
function mock(){
 let grant=false,notice=false,started=0;
 const c=createChieditore({files:{status:async()=>({granted:grant}),requestPermission:async()=>{grant=true;}},
 notifications:{checkPermissions:async()=>({receive:notice?'granted':'prompt'}),requestPermissions:async()=>{notice=true;}},
 native:{battery:async()=>({unrestricted:true}),begin:async()=>({pairCode:'abcdef123456'}),
 localStatus:async()=>({initialized:true})},
 tx:{start:async()=>{started++;},stop:async()=>{}}});
 return {c,started:()=>started};
}
test('signed enrollment prepares registration without admin approval or synthetic transfer',async()=>{
 const f=mock();assert.equal(await f.c.canRegister(),false);
 for(let i=0;i<4;i++)await f.c.next();
 assert.equal(f.c.snapshot().step,'ready');
 assert.equal(await f.c.canRegister(),true);
 assert.equal(f.started(),0);
});
test('file access must actually be granted by Android',async()=>{
 const c=createChieditore({files:{status:async()=>({granted:false}),requestPermission:async()=>({granted:true})}});
 assert.equal((await c.next()).state,'denied');
});
test('disposed setup rejects further steps',async()=>{
 const {c}=mock();await c.dispose();await assert.rejects(c.next(),/closed/);
});
test('simple onboarding hides pairing, diagnostic and test UI',()=>{
 const source=readFileSync(new URL('./chieditore.js',import.meta.url),'utf8');
 const ui=source.slice(source.indexOf('export function mountChieditore('));
 assert.doesNotMatch(ui,/pairCode|diagnosticReport|shareReport|300000|300.000|Codice/);
 assert.match(ui,/Preparazione di FreePT/);
 const main=readFileSync(new URL('./main.js',import.meta.url),'utf8');
 assert.doesNotMatch(main,/if\(!verified\?\.verified\)\{diagnosticPassed=false/);
 assert.match(main,/async function renderWorkspace\(\)\{void bindBootstrapAfterApproval\(\)/);
});
