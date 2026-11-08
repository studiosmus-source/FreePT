import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const start=source.indexOf('function showAdminBridge(){');
const end=source.indexOf('\nasync function showOwnerBridgeFolder()',start);
assert.ok(start>=0&&end>start);
const bridge=source.slice(start,end);
test('RX keys are saved locally without contacting unrelated original TX relay',()=>{
  assert.match(bridge,/await provider\.save\(\{rxKey:a,txKey:b\}\)/);
  assert.match(bridge,/await provider\.status\(\)/);
  assert.match(bridge,/bridge_keys_not_persisted/);
  assert.doesNotMatch(bridge,/createOriginalTxRx|CapacitorHttp|\.connect\(/);
  assert.match(bridge,/Chiavi salvate in modo sicuro sul telefono/);
});
test('existing TX registration is explicitly acknowledged instead of reset',()=>{
  assert.match(source,/Telefono già collegato/);
  assert.match(source,/Telefono già registrato: configurazione conservata/);
});
