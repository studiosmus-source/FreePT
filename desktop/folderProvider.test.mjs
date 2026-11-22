import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createBridgeDesktopFolderProvider} from './folderProvider.mjs';

async function fixture(run){
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'freept-desktop-'));
  const root=path.join(base,'shared');
  await fs.mkdir(root);
  try{return await run({base,root});}
  finally{await fs.rm(base,{recursive:true,force:true});}
}

test('lists hidden items, keeps folder-first order and paginates',async()=>{
  await fixture(async({root})=>{
    await fs.mkdir(path.join(root,'z-folder'));
    await fs.writeFile(path.join(root,'.hidden'),'hidden');
    await fs.writeFile(path.join(root,'visible.txt'),'visible');
    for(let i=0;i<100;i++)
      await fs.writeFile(path.join(root,`file-${String(i).padStart(3,'0')}.txt`),'x');
    const provider=await createBridgeDesktopFolderProvider({root});
    const roots=await provider.list();
    assert.equal(roots.entries.length,1);
    const selectedRoot=roots.entries[0].handle;
    const first=await provider.list({handle:selectedRoot});
    assert.equal(first.entries.length,100);
    assert.equal(first.entries[0].directory,true);
    assert.ok(first.entries.some(item=>item.name==='.hidden'));
    assert.equal(first.nextOffset,100);
    const second=await provider.list({handle:selectedRoot,offset:first.nextOffset});
    assert.equal(second.entries.length,3);
    assert.equal(second.nextOffset,-1);
    assert.ok(first.entries.every(item=>!('path'in item)));
    provider.close();
  });
});

test('reads exact byte ranges only through opaque handles',async()=>{
  await fixture(async({root})=>{
    const bytes=Buffer.from('alpha-beta-gamma');
    await fs.writeFile(path.join(root,'sample.txt'),bytes);
    const provider=await createBridgeDesktopFolderProvider({root});
    const roots=await provider.list();
    const page=await provider.list({handle:roots.entries[0].handle});
    const file=page.entries.find(item=>item.name==='sample.txt');
    assert.ok(file);
    const chunk=await provider.readChunk({handle:file.handle,offset:6,length:4});
    assert.equal(Buffer.from(chunk.base64,'base64').toString(),'beta');
    assert.equal(chunk.bytesRead,4);
    assert.equal(chunk.eof,false);
    await assert.rejects(
      provider.readChunk({handle:'root',offset:0,length:1}),
      /bridge_file_read_invalid/
    );
    await assert.rejects(
      provider.readChunk({handle:file.handle,offset:15,length:4}),
      /bridge_desktop_file_changed/
    );
    provider.close();
    await assert.rejects(
      provider.list(),
      /bridge_desktop_handle_invalid/
    );
  });
});

test('does not expose a symlink whose target leaves the chosen folder',async()=>{
  await fixture(async({base,root})=>{
    const outside=path.join(base,'outside.txt');
    await fs.writeFile(outside,'outside');
    try{await fs.symlink(outside,path.join(root,'outside-link.txt'));}
    catch(error){
      if(['EPERM','EACCES','ENOTSUP'].includes(error?.code))return;
      throw error;
    }
    const provider=await createBridgeDesktopFolderProvider({root});
    const roots=await provider.list();
    const page=await provider.list({handle:roots.entries[0].handle});
    assert.equal(page.entries.some(item=>item.name==='outside-link.txt'),false);
    provider.close();
  });
});

test('shows each explicitly selected drive or folder under one virtual root',async()=>{
  await fixture(async({base,root})=>{
    const second=path.join(base,'removable');
    await fs.mkdir(second);
    await fs.writeFile(path.join(root,'primary.txt'),'one');
    await fs.writeFile(path.join(second,'external.txt'),'two');
    const provider=await createBridgeDesktopFolderProvider({roots:[root,second]});
    const devices=await provider.list();
    assert.equal(devices.entries.length,2);
    assert.ok(devices.entries.every(item=>item.directory));
    const external=devices.entries.find(item=>item.name==='removable');
    const files=await provider.list({handle:external.handle});
    assert.equal(files.entries[0].name,'external.txt');
    provider.close();
  });
});
