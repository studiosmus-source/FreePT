import test from 'node:test';
import assert from 'node:assert/strict';
import {BRIDGE_FILE_LIMITS,validateBridgeFolderPage,validateBridgeReadRequest,
  validateBridgeFileChunk,validateBridgeJobIdentity} from '../src/bridgeFileProtocol.js';
const handle='22222222-2222-4222-8222-222222222222';
const valid={handle,name:'foto.jpg',directory:false,size:348,mime:'image/jpeg'};
test('folder page accepts selected-root metadata without paths or URI',()=>{
  const result=validateBridgeFolderPage({entries:[valid],nextOffset:-1});
  assert.equal(result.entries[0].name,'foto.jpg');
  assert.equal(Object.isFrozen(result.entries[0]),true);
});
test('reject unsafe names, paths, duplicate handles, injected columns and unbounded data',()=>{
  for(const name of ['../private','a/b','a\\b','\0',String.fromCharCode(10),'..',''.padEnd(256,'x')])
    assert.throws(()=>validateBridgeFolderPage({entries:[{...valid,name}],nextOffset:-1}));
  assert.throws(()=>validateBridgeFolderPage({entries:[valid,valid],nextOffset:-1}));
  assert.throws(()=>validateBridgeFolderPage({entries:[{...valid,uri:'content://secret'}],nextOffset:-1}));
  assert.throws(()=>validateBridgeFolderPage({entries:Array(101).fill(valid),nextOffset:-1}));
});
test('pagination cannot claim continuation without a complete page',()=>{
  assert.throws(()=>validateBridgeFolderPage({entries:[valid],nextOffset:100}));
});
test('chunk request is bounded by limit and handle authorization remains external',()=>{
  assert.deepEqual(validateBridgeReadRequest({handle,offset:0,length:262144}),
    {handle,offset:0,length:262144});
  for(const payload of [
    {handle:'root',offset:0,length:1},
    {handle,offset:-1,length:10},
    {handle,offset:0,length:262145},
    {handle,offset:0,length:0},
    {handle,offset:1.5,length:100},
    {handle,offset:0,length:2,command:'delete'}
  ])assert.throws(()=>validateBridgeReadRequest(payload));
});
test('chunk response validates encoded bytes and EOF',()=>{
  assert.equal(validateBridgeFileChunk({base64:'YWI=',bytesRead:2,eof:true},3).bytesRead,2);
  assert.throws(()=>validateBridgeFileChunk({base64:'YWI=',bytesRead:2,eof:false},3));
  assert.throws(()=>validateBridgeFileChunk({base64:'YWI=',bytesRead:3,eof:true},3));
  assert.throws(()=>validateBridgeFileChunk({base64:'YWI=',bytesRead:2,eof:true,uri:'x'},3));
});
test('job/device must be explicit valid identities',()=>{
  assert.deepEqual(validateBridgeJobIdentity({jobId:handle,deviceId:handle}),{jobId:handle,deviceId:handle});
  assert.throws(()=>validateBridgeJobIdentity({jobId:'x',deviceId:handle}));
  assert.equal(BRIDGE_FILE_LIMITS.maxChunkBytes,262144);
});
