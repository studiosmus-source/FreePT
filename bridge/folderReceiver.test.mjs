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
test('reports scan pages and pending descendants before any destination creation',async()=>{
 const progress=[],stages=[],events=[];
 const listPage=async({handle})=>handle==='root'?
  page([item(D,'Photos',true),item(F,'note.txt')]):
  page([item(F2,'picture.jpg')]);
 const result=await receiveBridgeFolder({
  listPage,onScanProgress:p=>progress.push(p),onStage:p=>stages.push(p),
  begin:async()=>events.push('begin'),makeDirectory:async()=>events.push('mkdir'),
  downloadFile:async()=>events.push('file'),commit:async()=>events.push('commit'),
  discard:async()=>events.push('discard')
 });
 assert.deepEqual(stages,['scanning','destination','transfer','finalizing']);
 assert.deepEqual(progress,[
  {scannedPages:1,scannedFolders:1,pendingFolders:1,foundEntries:2,foundFiles:1},
  {scannedPages:2,scannedFolders:2,pendingFolders:0,foundEntries:3,foundFiles:2}
 ]);
 assert.equal(events[0],'begin');
 assert.deepEqual(result,{entries:3,files:2});
});
test('scan cancellation never creates a destination folder',async()=>{
 const ctl=new AbortController(),stages=[];
 let created=false;
 await assert.rejects(receiveBridgeFolder({
  signal:ctl.signal,listPage:async()=>page([item(D,'subfolder',true)]),
  onStage:phase=>stages.push(phase),
  onScanProgress:()=>ctl.abort(),
  begin:async()=>{created=true},makeDirectory:async()=>{},downloadFile:async()=>{},
  commit:async()=>{},discard:async()=>{}
 }),/bridge_transfer_cancelled/);
 assert.equal(created,false);
 assert.deepEqual(stages,['scanning']);
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

test('verified inventory is independent of browsing and contains hidden nested entries',async()=>{
 const requests=[],hidden={...item(F2,'.secret'),size:3};
 const plan=await planBridgeFolder({listPage:async({handle,offset})=>{
  requests.push([handle,offset]);
  return handle==='root'?page([item(D,'.hiddenDir',true),item(F,'visible.txt')]):
    page([hidden]);
 }});
 assert.deepEqual(requests,[['root',0],[D,0]]);
 const {summarizeBridgeFolder}=await import('./folderReceiver.mjs');
 const summary=summarizeBridgeFolder(plan);
 assert.deepEqual(summary,{entries:3,files:2,directories:1,hidden:2,totalBytes:6});
});
test('cancel after verified file preserves a distinct partial folder',async()=>{
 const ac=new AbortController(),events=[];
 const result=await receiveBridgeFolder({
  signal:ac.signal,preserveCompletedOnCancel:true,
  listPage:async()=>page([item(D,'done.bin'),item(F,'interrupted.bin')]),
  begin:async()=>events.push('begin'),
  makeDirectory:async()=>{},
  downloadFile:async({path})=>{
   if(path[0]==='done.bin'){events.push('file:done');return;}
   events.push('file:discard');ac.abort();throw Error('bridge_transfer_cancelled');
  },
  commit:async options=>{
   events.push('commit:'+(options.partial?'partial':'full'));
   return {name:'Download (parziale)'};
  },
  discard:async()=>events.push('discard')
 });
 assert.equal(result.files,1);assert.equal(result.partial,true);
 assert.equal(result.savedName,'Download (parziale)');
 assert.deepEqual(events,['begin','file:done','file:discard','commit:partial']);
});
test('network failure still rolls back even if preserve-on-cancel enabled',async()=>{
 const events=[];
 await assert.rejects(receiveBridgeFolder({
  preserveCompletedOnCancel:true,
  listPage:async()=>page([item(D,'done.bin'),item(F,'broken.bin')]),
  begin:async()=>events.push('begin'),makeDirectory:async()=>{},
  downloadFile:async({path})=>{
   if(path[0]==='broken.bin')throw Error('network_failed');
   events.push('file:done');
  },
  commit:async()=>events.push('commit'),
  discard:async()=>events.push('discard')
 }),/network_failed/);
 assert.deepEqual(events,['begin','file:done','discard']);
});
test('download rejects unverified externally supplied manifest',async()=>{
 let began=false;
 await assert.rejects(receiveBridgeFolder({
  manifest:Object.freeze([]),begin:async()=>{began=true},
  makeDirectory:async()=>{},downloadFile:async()=>{},
  commit:async()=>{},discard:async()=>{}
 }),/plan_unverified/);
 assert.equal(began,false);
});
