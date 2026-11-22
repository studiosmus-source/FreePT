import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX=/^[0-9a-f]{64}$/;

export function createDesktopCredentialStore({
  filePath,safeStorage,fsApi=fs,uuid=randomUUID
}={}){
  if(typeof filePath!=='string'||!filePath||typeof safeStorage?.isAsyncEncryptionAvailable!=='function'||
     typeof safeStorage?.encryptStringAsync!=='function'||
     typeof safeStorage?.decryptStringAsync!=='function'||typeof uuid!=='function')
    throw Error('bridge_desktop_secure_storage_unavailable');

  async function writeSecret(value){
    if(await safeStorage.isAsyncEncryptionAvailable()!==true)
      throw Error('bridge_desktop_secure_storage_unavailable');
    const encrypted=await safeStorage.encryptStringAsync(JSON.stringify(value));
    if(!Buffer.isBuffer(encrypted)||encrypted.length<1)
      throw Error('bridge_desktop_secure_storage_unavailable');
    await fsApi.mkdir(path.dirname(filePath),{recursive:true,mode:0o700});
    const temporary=filePath+'.'+uuid()+'.tmp';
    try{
      await fsApi.writeFile(temporary,JSON.stringify({
        version:1,ciphertext:encrypted.toString('base64')
      }),{encoding:'utf8',mode:0o600,flag:'wx'});
      await fsApi.rename(temporary,filePath);
    }catch(error){
      try{await fsApi.unlink(temporary);}catch{}
      throw error;
    }
  }

  async function readSecret(){
    let envelope;
    try{envelope=JSON.parse(await fsApi.readFile(filePath,'utf8'));}
    catch(error){
      if(error?.code==='ENOENT')return null;
      throw Error('bridge_desktop_credentials_unavailable');
    }
    if(!envelope||envelope.version!==1||
       typeof envelope.ciphertext!=='string'||
       !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(envelope.ciphertext))
      throw Error('bridge_desktop_credentials_unavailable');
    if(await safeStorage.isAsyncEncryptionAvailable()!==true)
      throw Error('bridge_desktop_secure_storage_unavailable');
    let decrypted;
    try{decrypted=await safeStorage.decryptStringAsync(Buffer.from(envelope.ciphertext,'base64'));}
    catch{throw Error('bridge_desktop_credentials_unavailable');}
    const result=typeof decrypted==='string'?decrypted:decrypted?.result;
    if(typeof result!=='string')throw Error('bridge_desktop_credentials_unavailable');
    let value;
    try{value=JSON.parse(result);}catch{throw Error('bridge_desktop_credentials_unavailable');}
    if(!value||value.version!==1||!UUID.test(value.deviceId)||!HEX.test(value.deviceSecret))
      throw Error('bridge_desktop_credentials_unavailable');
    if(decrypted?.shouldReEncrypt===true)await writeSecret(value);
    return value;
  }

  return Object.freeze({
    async status(){
      const current=await readSecret();
      return current?{provisioned:true,deviceId:current.deviceId}:{provisioned:false};
    },
    async provision({deviceId,deviceSecret}={}){
      if(!UUID.test(deviceId)||!HEX.test(deviceSecret))
        throw Error('bridge_desktop_credentials_invalid');
      const existing=await readSecret();
      if(existing){
        if(existing.deviceId===deviceId)return {saved:true,alreadyProvisioned:true};
        throw Error('bridge_desktop_credentials_already_provisioned');
      }
      await writeSecret({version:1,deviceId,deviceSecret});
      return {saved:true};
    },
    async getDeviceSecret(){
      const current=await readSecret();
      if(!current)throw Error('bridge_desktop_credentials_missing');
      return current.deviceSecret;
    },
    async clear(){
      try{await fsApi.unlink(filePath);}
      catch(error){if(error?.code!=='ENOENT')throw Error('bridge_desktop_credentials_unavailable');}
      return {cleared:true};
    }
  });
}
