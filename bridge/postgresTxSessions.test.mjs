import test from 'node:test';
import assert from 'node:assert/strict';
import {BridgePostgresTxSessions} from './postgresTxSessions.mjs';
const DEVICE='11111111-1111-4111-8111-111111111111';
const VERIFIER='b'.repeat(64),SECRET='a'.repeat(64);
function fixture() {
 const calls=[];
 const db={async rpc(name,args) {
   calls.push({name,args});
   if(name==='bridge_server_open_tx_session')
     return {data:'2026-11-07T09:00:00.000Z',error:null};
   if(name==='bridge_server_assert_tx_session')
     return {data:args.p_token_hash_hex,error:null};
   if(name==='bridge_server_close_tx_session')return {data:true,error:null};
   throw Error('unrecognized');
 }};
 const authenticateDevice=async ({deviceId,deviceSecret})=>
   deviceId===DEVICE&&deviceSecret===SECRET?{verifierHex:VERIFIER}:null;
 const sessions=new BridgePostgresTxSessions({rpcClient:db,authenticateDevice});
 return {calls,db,sessions,authenticateDevice};
}
test('authenticated TX opens only opaque hashed session in DB',async ()=>{
 const f=fixture();
 const session=await f.sessions.connect({deviceId:DEVICE,deviceSecret:SECRET});
 assert.match(session.token,/^[0-9a-f]{64}$/);
 assert.equal(session.expiresAt,Date.parse('2026-11-07T09:00:00Z'));
 assert.equal(f.calls[0].name,'bridge_server_open_tx_session');
 assert.equal(f.calls[0].args.p_verifier_hex,VERIFIER);
 assert.notEqual(f.calls[0].args.p_token_hash_hex,session.token);
 assert.match(f.calls[0].args.p_token_hash_hex,/^[0-9a-f]{64}$/);
 assert.equal(await f.sessions.getDispatchBinding({
   deviceId:DEVICE,token:session.token
 }),f.calls[0].args.p_token_hash_hex);
 assert.equal(await f.sessions.close({deviceId:DEVICE,token:session.token}),true);
});
test('unverified TX never reaches DB',async ()=>{
 const f=fixture();
 await assert.rejects(()=>f.sessions.connect({deviceId:DEVICE,deviceSecret:'f'.repeat(64)}),
   /device_not_authenticated/);
 await assert.rejects(()=>f.sessions.connect({deviceId:'invalid',deviceSecret:SECRET}),
   /device_not_authenticated/);
 await assert.rejects(()=>f.sessions.getDispatchBinding({deviceId:DEVICE,token:'x'}),
   /invalid_device_session/);
 assert.equal(f.calls.length,0);
});
test('database errors, mismatched binding and invalid expiry fail closed',async ()=>{
 const f=fixture();
 const session=await f.sessions.connect({deviceId:DEVICE,deviceSecret:SECRET});
 f.db.rpc=async ()=>({data:null,error:{code:'42501'}});
 await assert.rejects(()=>f.sessions.getDispatchBinding({
   deviceId:DEVICE,token:session.token
 }),/bridge_session_database_unavailable/);
 f.db.rpc=async ()=>({data:'not-an-authorized-hash',error:null});
 await assert.rejects(()=>f.sessions.getDispatchBinding({
   deviceId:DEVICE,token:session.token
 }),/invalid_device_session/);
 await assert.rejects(()=>f.sessions.connect({deviceId:DEVICE,deviceSecret:SECRET}),
   /bridge_session_invalid_response/);
 f.db.rpc=async ()=>{throw Error('db down')};
 await assert.rejects(()=>f.sessions.close({
   deviceId:DEVICE,token:session.token
 }),/bridge_session_database_unavailable/);
});
test('invalid dependencies are refused',()=>{
 assert.throws(()=>new BridgePostgresTxSessions({
   rpcClient:{},authenticateDevice:async()=>null
 }),/invalid_postgres_session_dependencies/);
});
