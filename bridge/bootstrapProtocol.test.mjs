import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,randomBytes,randomUUID} from 'node:crypto';
import {bootstrapMessage,verifyBootstrapEnvelope,bootstrapBytes,bootstrapHash} from './bootstrapProtocol.mjs';
const key=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const pub=key.publicKey.export({type:'spki',format:'der'}).toString('base64');
function envelope(action='start',payload={consent:true}){
 const e={deviceId:randomUUID(),timestamp:Date.now(),nonce:randomBytes(16).toString('hex'),payload:JSON.stringify(payload)};
 e.signature=sign('sha256',Buffer.from(bootstrapMessage(action,e)),key.privateKey).toString('base64');return e;
}
test('native-compatible DER P256 signature authenticates exact action/body/device',()=>{
 const e=envelope();assert.equal(verifyBootstrapEnvelope('start',e,pub),true);
 for(const change of [{deviceId:randomUUID()},{payload:'{}'},{nonce:'0'.repeat(32)},{signature:'x'.repeat(96)},{timestamp:e.timestamp-120000}])
  assert.equal(verifyBootstrapEnvelope('start',{...e,...change},pub),false);
 assert.equal(verifyBootstrapEnvelope('claim',e,pub),false);
 const alien=generateKeyPairSync('ec',{namedCurve:'prime256v1'}).publicKey.export({type:'spki',format:'der'}).toString('base64');
 assert.equal(verifyBootstrapEnvelope('start',e,alien),false);
});
test('proof rejects missing fields, extra fields, wrong keys, clock skew and malformed JSON envelopes',()=>{
 const e=envelope();
 for(const bad of [null,{}, {...e,extra:'admin'}, {...e,timestamp:String(e.timestamp)}, {...e,nonce:'../'}, {...e,payload:'x'.repeat(355001)}])
  assert.equal(verifyBootstrapEnvelope('start',bad,pub),false);
 assert.equal(verifyBootstrapEnvelope('start',e,pub,e.timestamp+60001),false);
 assert.equal(verifyBootstrapEnvelope('start',e,'invalid'),false);
});
test('synthetic fixture over 256KiB is deterministic, chunk-boundary independent, challenge-bound',()=>{
 const challenge='a1'.repeat(32),a=bootstrapBytes(challenge,0,262144),b=bootstrapBytes(challenge,262144,37856);
 assert.equal(a.length+b.length,300000);
 assert.notEqual(bootstrapHash(a),bootstrapHash(bootstrapBytes('b2'.repeat(32),0,262144)));
 assert.deepEqual(a.subarray(10000,11000),bootstrapBytes(challenge,10000,1000));
 for(const args of [['..',0,1],[challenge,-1,1],[challenge,0,262145],[challenge,299999,2]])assert.throws(()=>bootstrapBytes(...args));
});
