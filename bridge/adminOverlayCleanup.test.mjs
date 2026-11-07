import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const entry=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const start=entry.indexOf('function closeAdminOverlays(){');
const end=entry.indexOf('\nfunction showAdminBridge(){',start);
assert.ok(start>=0&&end>start,'Admin overlay cleanup function must exist');
const cleanupSource=entry.slice(start,end);
function harness(){
  const removed=[];
  const panels=new Map([
    ['adminBridgePanel',{remove(){removed.push('adminBridgePanel')}}],
    ['chatActions',{remove(){removed.push('chatActions')}}]
  ]);
  const context={
    document:{getElementById:id=>panels.get(id)||null},
    removed
  };
  runInNewContext(cleanupSource+'\nthis.clean=closeAdminOverlays;',context);
  return context;
}
test('admin overlay cleanup removes Bridge and destructive action dialogs',()=>{
  const h=harness();
  h.clean();
  assert.deepEqual(h.removed,['adminBridgePanel','chatActions']);
});
test('admin overlay cleanup tolerates absent panels',()=>{
  const h=harness();
  h.clean();
  h.document.getElementById=()=>null;
  assert.doesNotThrow(()=>h.clean());
});
test('every admin exit or screen replacement invokes overlay cleanup',()=>{
  const transitions=[
    'function requestScreen(denied=false){',
    'function adminScreen(){',
    'function waitingScreen(){',
    'async function logout(){',
    'function renderLayout(){'
  ];
  for(const startText of transitions){
    const pos=entry.indexOf(startText);
    assert.ok(pos>=0,startText+' missing');
    assert.match(entry.slice(pos,pos+145),/closeAdminOverlays\(\)/,startText+' must clean overlays');
  }
  assert.match(entry,/if\(document.visibilityState==='hidden'&&profile\?\.role==='admin'[\s\S]{0,140}closeAdminOverlays\(\)/);
});
