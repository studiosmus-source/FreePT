import test from 'node:test';
import assert from 'node:assert/strict';
import {planBridgeFolder,receiveBridgeFolder} from './folderReceiver.mjs';
const D='11111111-1111-4111-8111-111111111111';
const F='22222222-2222-4222-8222-222222222222';
const F2='33333333-3333-4333-8333-333333333333';
const item=(handle,name,directory=false)=>({handle,name,directory,size:directory?-1:3,mime:directory?'vnd.android.document/directory':'text/plain'});
const page=(entries,nextOffset=-1)=>({entries,nextOffset});
test('discovers nested folder and preserves relative paths',async()=>{
 const calls=[];
 const result=await planBridgeFolder({listPage:async request=>{
  calls.push(request);
  return request.handle==='root'?page([item(D,'Foto',true),item(F,'note.txt')]):page([item(F2,'foto.jpg')]);
 }});
 assert.deepEqual(result.map(x=>x.path.join('/')),['Foto','note.txt','Foto/foto.jpg']);
 assert.deepEqual(calls,[{handle:'root',offset:0},{handle:D,offset:0}]);
});
test('receives files with a whole-directory staging lifecycle',async()=>{
 const events=[];
 const result=await receiveBridgeFolder({
  listPage:async({handle})=>handle==='root'?page([item(D,'A',true)]):page([item(F,'B.txt')]),
  begin:async()=>events.push('begin'),makeDirectory:async p=>events.push('mkdir:'+p.join('/')),
  downloadFile:async({path})=>events.push('file:'+path.join('/')),
  commit:async()=>events.push('commit'),discard:async()=>events.push('discard')
 });
 assert.deepEqual(events,['begin','mkdir:A','file:A/B.txt','commit']);
 assert.deepEqual(result,{entries:2,files:1});
});
test('rejects directory traversal before destination is touched',async()=>{
 let begun=false;
 await assert.rejects(receiveBridgeFolder({listPage:async()=>page([item(F,'../secret')]),
  begin:async()=>{begun=true},makeDirectory:async()=>{},downloadFile:async()=>{},commit:async()=>{},discard:async()=>{}}),/metadata_invalid/);
 assert.equal(begun,false);
});
test('refuses duplicate names ignoring case and normalization',async()=>{
 await assert.rejects(planBridgeFolder({listPage:async()=>page([item(D,'Readme'),item(F,'README')])}),/duplicate_name/);
});
test('rejects cyclic/reused handles without recursively traversing',async()=>{
 await assert.rejects(planBridgeFolder({listPage:async({handle})=>handle==='root'?page([item(D,'one',true)]):page([item(D,'self',true)])}),/handle_reused/);
});
test('rollback after failure downloading a file',async()=>{
 const events=[];
 await assert.rejects(receiveBridgeFolder({listPage:async()=>page([item(F,'x')]),
  begin:async()=>events.push('begin'),makeDirectory:async()=>{},
  downloadFile:async()=>{throw Error('offline')},commit:async()=>events.push('commit'),
  discard:async()=>events.push('discard')}),/offline/);
 assert.deepEqual(events,['begin','discard']);
});
test('cancellation before starting destination prevents writes',async()=>{
 const ac=new AbortController();let touched=false;
 await assert.rejects(receiveBridgeFolder({signal:ac.signal,
  listPage:async()=>{ac.abort();return page([])},begin:async()=>{touched=true},
  makeDirectory:async()=>{},downloadFile:async()=>{},commit:async()=>{},discard:async()=>{}}),/cancelled/);
 assert.equal(touched,false);
});
test('rejects unknown file size and caps tree entries',async()=>{
 const unknown={...item(F,'bad'),size:-1};
 await assert.rejects(planBridgeFolder({listPage:async()=>page([unknown])}),/unknown_file_size/);
 await assert.rejects(planBridgeFolder({maxEntries:1,listPage:async()=>page([item(D,'a'),item(F,'b')])}),/entry_limit/);
});
