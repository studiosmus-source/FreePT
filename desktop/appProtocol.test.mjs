import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createAppAssetHandler} from './appProtocol.mjs';

test('serves only bundled app assets and rejects traversal and other hosts',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'freept-assets-'));
  await fs.writeFile(path.join(root,'index.html'),'<h1>FreePT</h1>');
  await fs.mkdir(path.join(root,'assets'));
  await fs.writeFile(path.join(root,'assets','main.js'),'ok');
  const serve=createAppAssetHandler({appRoot:root});
  try{
    const page=await serve({method:'GET',url:'capacitor://localhost/'});
    assert.equal(page.status,200);
    assert.match(page.headers.get('content-type'),/text\/html/);
    assert.equal(await page.text(),'<h1>FreePT</h1>');
    assert.equal((await serve({
      method:'GET',url:'capacitor://localhost/assets/main.js'
    })).status,200);
    assert.equal((await serve({
      method:'GET',url:'capacitor://localhost/%2e%2e/secret'
    })).status,404);
    assert.equal((await serve({
      method:'GET',url:'capacitor://other-host/'
    })).status,404);
    assert.equal((await serve({
      method:'POST',url:'capacitor://localhost/'
    })).status,405);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
