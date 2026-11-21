import test from 'node:test';
import assert from 'node:assert/strict';
import {createBridgeFolderPrefetch} from '../src/bridgeFolderPrefetch.js';
import {BRIDGE_FILE_LIMITS} from '../src/bridgeFileProtocol.js';

const files=(count=100)=>Array.from({length:count},(_,index)=>({
  name:'file-'+index,directory:false
}));
const dirs=(count=1)=>Array.from({length:count},(_,index)=>({
  name:'folder-'+index,directory:true
}));

test('legacy file-first catalogue: pages continue until last two folders on page 8',()=>{
 const scan=createBridgeFolderPrefetch();
 for(let index=0;index<7;index++){
  const r=scan.record({handle:'root',offset:index*100,
   page:{entries:files(),nextOffset:(index+1)*100}});
  assert.equal(r.autoFetch,true);
  assert.equal(r.complete,false);
 }
 const last=scan.record({handle:'root',offset:700,
  page:{entries:[...files(83),...dirs(2)],nextOffset:-1}});
 assert.deepEqual({pages:last.pagesRead,items:last.itemsSeen,complete:last.complete},
  {pages:8,items:785,complete:true});
 assert.equal(last.autoFetch,false);
});

test('scan must continue even if page ONE already has some folders',()=>{
 const scan=createBridgeFolderPrefetch();
 const first=scan.record({handle:'root',offset:0,
  page:{entries:[...dirs(4),...files(96)],nextOffset:100}});
 assert.equal(first.autoFetch,true);
 const second=scan.record({handle:'root',offset:100,
  page:{entries:[...files(90),...dirs(10)],nextOffset:200}});
 assert.equal(second.autoFetch,true);
 const end=scan.record({handle:'root',offset:200,
  page:{entries:[...files(12),...dirs(1)],nextOffset:-1}});
 assert.equal(end.complete,true);
 assert.equal(end.itemsSeen,213);
});

test('more than 16 pages of files and hidden folders are still automatically scanned',()=>{
 const scan=createBridgeFolderPrefetch();
 for(let i=0;i<23;i++){
  const page=scan.record({handle:'nested',offset:i*100,
   page:{entries:i===0?[...dirs(1),...files(99)]:files(),
      nextOffset:(i+1)*100}});
  assert.equal(page.autoFetch,true,'page '+(i+1));
  assert.equal(page.atLimit,false);
 }
 const last=scan.record({handle:'nested',offset:2300,
  page:{entries:[{name:'.hidden-folder',directory:true}],nextOffset:-1}});
 assert.equal(last.complete,true);
 assert.equal(last.pagesRead,24);
 assert.equal(last.itemsSeen,2301);
});

test('a complete first page and an empty folder do not request more work',()=>{
 const scan=createBridgeFolderPrefetch();
 const result=scan.record({handle:'root',offset:0,
  page:{entries:dirs(17),nextOffset:-1}});
 assert.equal(result.complete,true);
 assert.equal(result.autoFetch,false);
 const empty=scan.record({handle:'nested',offset:0,
  page:{entries:[],nextOffset:-1}});
 assert.deepEqual({complete:empty.complete,pages:empty.pagesRead},
  {complete:true,pages:1});
});

test('the last legal page at offset 10000 can complete a 10001-item folder',()=>{
 const scan=createBridgeFolderPrefetch();
 let result;
 for(let i=0;i<100;i++){
  result=scan.record({handle:'root',offset:i*100,
   page:{entries:files(),nextOffset:(i+1)*100}});
 }
 assert.equal(result.autoFetch,true,'offset 10000 is still readable by TX');
 assert.equal(result.complete,false);
 assert.equal(result.itemsSeen,BRIDGE_FILE_LIMITS.maxTotalEntries);
 const last=scan.record({handle:'root',offset:10000,
   page:{entries:dirs(1),nextOffset:-1}});
 assert.equal(last.complete,true);
 assert.equal(last.itemsSeen,10001);
});

test('a different folder or reloading the root resets progress',()=>{
 const scan=createBridgeFolderPrefetch();
 scan.record({handle:'root',offset:0,page:{entries:files(),nextOffset:100}});
 const second=scan.record({handle:'nested',offset:0,
  page:{entries:dirs(2),nextOffset:-1}});
 assert.equal(second.pagesRead,1);
 const again=scan.record({handle:'root',offset:0,
  page:{entries:dirs(3),nextOffset:-1}});
 assert.equal(again.pagesRead,1);
});

test('reject out-of-order, looping, malformed or unbounded paging',()=>{
 const scan=createBridgeFolderPrefetch();
 assert.throws(()=>createBridgeFolderPrefetch({maxEntries:BRIDGE_FILE_LIMITS.maxTotalEntries+1}),/invalid_limit/);
 assert.throws(()=>scan.record({handle:'root',offset:100,
  page:{entries:files(),nextOffset:200}}),/missing_first_page/);
 scan.record({handle:'root',offset:0,page:{entries:files(),nextOffset:100}});
 assert.throws(()=>scan.record({handle:'root',offset:200,
  page:{entries:files(),nextOffset:-1}}),/nonsequential_page/);
 assert.throws(()=>scan.record({handle:'root',offset:100,
  page:{entries:files(),nextOffset:100}}),/invalid_page/);
 assert.throws(()=>scan.record({handle:'root',offset:100,
  page:{entries:null,nextOffset:200}}),/invalid_page/);
});
