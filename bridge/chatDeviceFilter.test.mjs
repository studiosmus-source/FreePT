import test from 'node:test';
import assert from 'node:assert/strict';
import {filterOwnerAuthorizedDevices} from '../src/bridgeChatDeviceFilter.js';
const a={device_id:'d1',bridge_devices:{id:'d1',owner_id:'family-a',label:'A',bridge_enabled:true}};
const b={device_id:'d2',bridge_devices:{id:'d2',owner_id:'family-b',label:'B',bridge_enabled:true}};
test('per-chat filter isolates owner even if database returns more grants',()=>{
  assert.deepEqual(filterOwnerAuthorizedDevices([a,b],{ownerId:'family-a'}).map(x=>x.id),['d1']);
  assert.deepEqual(filterOwnerAuthorizedDevices([a,b],{ownerId:'family-b'}).map(x=>x.id),['d2']);
  assert.deepEqual(filterOwnerAuthorizedDevices([a,b],{ownerId:'unregistered'}),[]);
});
test('reject mismatched ids, disabled devices, missing owner, duplicate rows',()=>{
  const rows=[a,a,{device_id:'other',bridge_devices:{...a.bridge_devices}},
    {device_id:'d3',bridge_devices:{id:'d3',owner_id:'family-a',bridge_enabled:false}},
    {device_id:'d4',bridge_devices:{id:'d4',bridge_enabled:true}}];
  assert.deepEqual(filterOwnerAuthorizedDevices(rows,{ownerId:'family-a'}).map(x=>x.id),['d1']);
});
test('malformed database and owner inputs fail closed',()=>{
  assert.deepEqual(filterOwnerAuthorizedDevices(null,{ownerId:'family-a'}),[]);
  assert.deepEqual(filterOwnerAuthorizedDevices([a],{ownerId:''}),[]);
  assert.deepEqual(filterOwnerAuthorizedDevices([a],{ownerId:3}),[]);
});
