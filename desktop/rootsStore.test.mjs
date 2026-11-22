import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createDesktopRootsStore} from './rootsStore.mjs';

test('persists only folders chosen by the user and deduplicates them',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'freept-roots-'));
  const root=path.join(directory,'shared');
  const notDirectory=path.join(directory,'file.txt');
  await fs.mkdir(root);
  await fs.writeFile(notDirectory,'x');
  try{
    const store=createDesktopRootsStore({filePath:path.join(directory,'settings','roots.json')});
    assert.deepEqual(await store.get(),[]);
    assert.deepEqual(await store.replace([root,root,notDirectory,path.join(directory,'missing')]),
      {saved:true,count:1});
    assert.deepEqual(await store.get(),[await fs.realpath(root)]);
    assert.deepEqual(await store.clear(),{cleared:true});
    assert.deepEqual(await store.get(),[]);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});
