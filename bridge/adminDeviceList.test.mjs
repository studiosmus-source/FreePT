import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const entry=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const first=entry.indexOf('async function loadAdminBridgeDevices(panel){');
const last=entry.indexOf('\nfunction showAdminBridge(){',first);
assert.ok(first>=0 && last>first,'Bridge read-only loader must be present');
const source=entry.slice(first,last);

function makeHarness(response,{connected=true,role='admin',unlocked=true}={}){
  const calls=[];
  const content={textContent:'',innerHTML:''};
  const active={getAttribute:()=> 'true'};
  const panel={
    isConnected:connected,
    querySelector:selector=>selector==='#bridgeAdminContent'?content:active
  };
  const db={from(name){
    calls.push(name);
    return {select(columns){
      calls.push(columns);
      return {order(column){
        calls.push(column);
        return {limit(n){calls.push(n);return Promise.resolve(response)}};
      }};
    }};
  }};
  const context={
    db,panel,profile:{role},adminUnlocked:unlocked,
    esc:s=>String(s??'').replace(/[&<>"]/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[x]))
  };
  runInNewContext(source+'\nthis.load=loadAdminBridgeDevices;',context);
  return {context,content,calls,panel};
}

test('approved admin reads only Bridge device metadata using RLS client',async()=>{
  const h=makeHarness({data:[{id:'id1',label:'Telefono prova',bridge_enabled:true}],error:null});
  await h.context.load(h.panel);
  assert.deepEqual(h.calls,['bridge_devices','id,label,bridge_enabled','label',100]);
  assert.match(h.content.innerHTML,/Telefono prova/);
  assert.match(h.content.innerHTML,/Bridge attivato/);
  assert.match(h.content.innerHTML,/non è ancora verificata/);
});

test('Bridge device label is escaped and does not become markup',async()=>{
  const h=makeHarness({data:[{id:'x',label:'<img src=x onerror=alert(1)>',bridge_enabled:false}],error:null});
  await h.context.load(h.panel);
  assert.doesNotMatch(h.content.innerHTML,/<img /);
  assert.match(h.content.innerHTML,/&lt;img/);
});

test('missing migration shows safe informative state',async()=>{
  const h=makeHarness({data:null,error:{code:'42P01',message:'missing table'}});
  await h.context.load(h.panel);
  assert.match(h.content.textContent,/non configurato/);
});

test('unavailable database does not expose backend error details',async()=>{
  const h=makeHarness({data:null,error:{code:'42501',message:'internal database credentials'}});
  await h.context.load(h.panel);
  assert.match(h.content.textContent,/Impossibile leggere/);
  assert.doesNotMatch(h.content.textContent,/credentials/);
});

test('closed panel or revoked admin session cannot display late result',async()=>{
  const h=makeHarness({data:[{label:'Riservato',bridge_enabled:true}],error:null});
  const promise=h.context.load(h.panel);
  h.panel.isConnected=false;
  await promise;
  assert.doesNotMatch(h.content.innerHTML,/Riservato/);
  const denied=makeHarness({data:[],error:null},{role:'user'});
  await denied.context.load(denied.panel);
  assert.equal(denied.calls.length,0);
});
