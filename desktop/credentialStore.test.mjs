import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createDesktopCredentialStore} from './credentialStore.mjs';

const DEVICE='11111111-1111-4111-8111-111111111111';
const OTHER='22222222-2222-4222-8222-222222222222';
const SECRET='a'.repeat(64);
const OTHER_SECRET='b'.repeat(64);

function fakeSafeStorage(){
  return {
    async isAsyncEncryptionAvailable(){return true;},
    async encryptStringAsync(value){return Buffer.from(value,'utf8');},
    async decryptStringAsync(value){return {result:value.toString('utf8'),shouldReEncrypt:false};}
  };
}

test('stores only encrypted device credentials and never replaces a bound device',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'freept-credentials-'));
  const filePath=path.join(directory,'bridge-credentials.json');
  try{
    const store=createDesktopCredentialStore({filePath,safeStorage:fakeSafeStorage()});
    assert.deepEqual(await store.status(),{provisioned:false});
    assert.deepEqual(await store.provision({deviceId:DEVICE,deviceSecret:SECRET}),{saved:true});
    assert.deepEqual(await store.status(),{provisioned:true,deviceId:DEVICE});
    assert.equal(await store.getDeviceSecret(),SECRET);
    const persisted=await fs.readFile(filePath,'utf8');
    assert.equal(persisted.includes(SECRET),false);
    assert.equal(persisted.includes(DEVICE),false);
    assert.deepEqual(
      await store.provision({deviceId:DEVICE,deviceSecret:OTHER_SECRET}),
      {saved:true,alreadyProvisioned:true}
    );
    await assert.rejects(
      store.provision({deviceId:OTHER,deviceSecret:OTHER_SECRET}),
      /already_provisioned/
    );
    assert.equal(await store.getDeviceSecret(),SECRET);
    assert.deepEqual(await store.clear(),{cleared:true});
    assert.deepEqual(await store.status(),{provisioned:false});
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('fails closed when operating-system encryption is unavailable',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'freept-credentials-'));
  try{
    const store=createDesktopCredentialStore({
      filePath:path.join(directory,'bridge-credentials.json'),
      safeStorage:{...fakeSafeStorage(),async isAsyncEncryptionAvailable(){return false;}}
    });
    await assert.rejects(
      store.provision({deviceId:DEVICE,deviceSecret:SECRET}),
      /secure_storage_unavailable/
    );
    assert.equal(await fs.stat(directory).then(info=>info.isDirectory()),true);
    await assert.rejects(fs.stat(path.join(directory,'bridge-credentials.json')));
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});
