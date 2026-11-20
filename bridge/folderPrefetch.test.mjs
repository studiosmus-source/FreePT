import test from 'node:test';
import assert from 'node:assert/strict';
import {createBridgeFolderPrefetch} from '../src/bridgeFolderPrefetch.js';

const files=(count=100)=>Array.from({length:count},(_,index)=>({
  name:'file-'+index,directory:false
}));
const dirs=(count=1)=>Array.from({length:count},(_,index)=>({
  name:'folder-'+index,directory:true
}));

test('file-first legacy catalogue scans subsequent pages to discover real folders',()=>{
  const tracker=createBridgeFolderPrefetch({maxAutomaticPages:16});
  let r=tracker.record({handle:'root',offset:0,page:{entries:files(),nextOffset:100}});
  assert.equal(r.autoFetch,true);
  assert.equal(r.pending,true);
  for(let page=2;page<=7;page++){
    r=tracker.record({handle:'root',offset:(page-1)*100,
      page:{entries:files(),nextOffset:page*100}});
    assert.equal(r.autoFetch,true);
  }
  r=tracker.record({handle:'root',offset:700,
    page:{entries:[...files(83),...dirs(2)],nextOffset:-1}});
  assert.equal(r.pending,false);
  assert.equal(r.autoFetch,false);
  assert.equal(r.pagesRead,8);
});

test('current directory-first TX needs no background crawl',()=>{
  const r=createBridgeFolderPrefetch().record({handle:'root',offset:0,
    page:{entries:[...dirs(2),...files(98)],nextOffset:100}});
  assert.equal(r.pending,false);
  assert.equal(r.autoFetch,false);
});

test('large legacy catalogues stop background scanning after bounded budget',()=>{
  const tracker=createBridgeFolderPrefetch({maxAutomaticPages:3});
  assert.equal(tracker.record({handle:'root',offset:0,
    page:{entries:files(),nextOffset:100}}).autoFetch,true);
  assert.equal(tracker.record({handle:'root',offset:100,
    page:{entries:files(),nextOffset:200}}).autoFetch,true);
  const result=tracker.record({handle:'root',offset:200,
    page:{entries:files(),nextOffset:300}});
  assert.equal(result.atLimit,true);
  assert.equal(result.autoFetch,false);
  assert.equal(result.pending,true);
});

test('folder navigation resets discovery, and a complete file-only folder is not scanned',()=>{
  const tracker=createBridgeFolderPrefetch();
  tracker.record({handle:'root',offset:0,page:{entries:files(),nextOffset:100}});
  const r=tracker.record({handle:'nested',offset:0,
    page:{entries:files(7),nextOffset:-1}});
  assert.deepEqual({pending:r.pending,autoFetch:r.autoFetch,pagesRead:r.pagesRead},
    {pending:false,autoFetch:false,pagesRead:1});
});

test('invalid discovery inputs fail closed',()=>{
  assert.throws(()=>createBridgeFolderPrefetch({maxAutomaticPages:0}),/invalid_limit/);
  assert.throws(()=>createBridgeFolderPrefetch().record({handle:'root',offset:0,
    page:{entries:null,nextOffset:100}}),/invalid_page/);
});
