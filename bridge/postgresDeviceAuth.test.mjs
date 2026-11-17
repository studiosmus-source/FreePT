import test from 'node:test';
import assert from 'node:assert/strict';
import {BridgeDeviceCredentials,verifyTrustedDeviceSecret} from './deviceCredentials.mjs';
import {createPostgresDeviceAuthenticator} from './postgresDeviceAuth.mjs';
const D='11111111-1111-4111-8111-111111111111';
function setup(){
 const creds=new BridgeDeviceCredentials();
 const {secret}=creds.issue(D);
 const v=creds.exportVerifier(D);
 const calls=[];
 const client={from(table){
   calls.push({table});
   return {select(columns){
     calls.push({columns});
     return {eq(field,id){
       calls.push({field,id});
       return {async maybeSingle(){
         return {data:{device_id:D,salt_hex:v.salt,verifier_hex:v.verifier},error:null};
       }};
     }};
   }};
 }};
 return {secret,v,calls,client,auth:createPostgresDeviceAuthenticator({verifiersClient:client})};
}
test('persistent verifier validates device secret with identical original KDF',async ()=>{
 const f=setup();
 assert.deepEqual(await f.auth({deviceId:D,deviceSecret:f.secret}),{verifierHex:f.v.verifier});
 assert.deepEqual(f.calls,[{table:'bridge_device_verifiers'},
   {columns:'device_id,salt_hex,verifier_hex'},{field:'device_id',id:D}]);
 assert.equal(verifyTrustedDeviceSecret({
   deviceId:D,secret:f.secret,salt:f.v.salt,verifier:f.v.verifier
 }),true);
 assert.equal(verifyTrustedDeviceSecret({
   deviceId:D,secret:'f'.repeat(64),salt:f.v.salt,verifier:f.v.verifier
 }),false);
});
test('invalid input never reads DB and wrong bearer never authenticates',async ()=>{
 const f=setup();
 for(const args of [
   {},{deviceId:'bad',deviceSecret:f.secret},
   {deviceId:D,deviceSecret:'bad'},
   {deviceId:D,deviceSecret:f.secret.toUpperCase()}
 ])assert.equal(await f.auth(args),null);
 assert.equal(f.calls.length,0);
 assert.equal(await f.auth({deviceId:D,deviceSecret:'f'.repeat(64)}),null);
});
test('unknown and malformed verifier rows are denied',async ()=>{
 const f=setup();
 for(const data of [null,[],{}, {device_id:'another',salt_hex:f.v.salt,verifier_hex:f.v.verifier},
   {device_id:D,salt_hex:'0',verifier_hex:f.v.verifier}]) {
   f.client.from=()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data,error:null})})})});
   assert.equal(await f.auth({deviceId:D,deviceSecret:f.secret}),null);
 }
});
test('query errors fail closed and cannot silently reuse a cached verifier',async ()=>{
 const f=setup();
 f.client.from=()=>{throw new Error('db outage');};
 await assert.rejects(()=>f.auth({deviceId:D,deviceSecret:f.secret}),
   /bridge_device_verifier_unavailable/);
 f.client.from=()=>({select:()=>({eq:()=>({maybeSingle:async()=>({
   data:null,error:{code:'42501'}
 })})})});
 await assert.rejects(()=>f.auth({deviceId:D,deviceSecret:f.secret}),
   /bridge_device_verifier_unavailable/);
});
test('invalid client rejected and hash inputs fail closed',()=>{
 assert.throws(()=>createPostgresDeviceAuthenticator({verifiersClient:{}}),
   /invalid_device_auth_dependencies/);
 assert.equal(verifyTrustedDeviceSecret({
   deviceId:D,secret:'x',salt:'0'.repeat(32),verifier:'a'.repeat(64)
 }),false);
});
