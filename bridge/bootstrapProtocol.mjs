/** Device-key proof format. No account, bearer secret or private file is involved. */
import {createHash,createPublicKey,verify} from 'node:crypto';
export const BOOTSTRAP_SIZE=300000;
export const bootstrapHash=value=>createHash('sha256').update(value).digest('hex');
export function bootstrapBytes(challenge,offset,length){
 if(!/^[0-9a-f]{64}$/.test(challenge)||!Number.isInteger(offset)||!Number.isInteger(length)||
   offset<0||length<1||length>262144||offset+length>BOOTSTRAP_SIZE)throw Error('bootstrap_invalid_range');
 const seed=Buffer.from(challenge,'hex'),out=Buffer.alloc(length);
 for(let i=0;i<length;i++)out[i]=seed[(offset+i)%32]^((offset+i)&255);
 return out;
}
export function bootstrapMessage(action,envelope){
 return ['freept-bootstrap-v1',action,envelope.deviceId,String(envelope.timestamp),envelope.nonce,envelope.payload].join('\n');
}
export function verifyBootstrapEnvelope(action,e,publicKey,now=Date.now()){
 try{
  if(!e||Object.keys(e).sort().join(',')!=='deviceId,nonce,payload,signature,timestamp'||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(e.deviceId)||
    !Number.isSafeInteger(e.timestamp)||Math.abs(now-e.timestamp)>60000||
    !/^[0-9a-f]{32}$/.test(e.nonce)||typeof e.payload!=='string'||Buffer.byteLength(e.payload)>355000||
    typeof e.signature!=='string'||!/^[A-Za-z0-9+/]{80,104}={0,2}$/.test(e.signature)||
    typeof publicKey!=='string'||!/^[A-Za-z0-9+/]{100,160}={0,2}$/.test(publicKey))return false;
  const key=createPublicKey({key:Buffer.from(publicKey,'base64'),format:'der',type:'spki'});
  if(key.asymmetricKeyType!=='ec'||key.asymmetricKeyDetails?.namedCurve!=='prime256v1')return false;
  return verify('sha256',Buffer.from(bootstrapMessage(action,e)),key,Buffer.from(e.signature,'base64'));
 }catch{return false;}
}
