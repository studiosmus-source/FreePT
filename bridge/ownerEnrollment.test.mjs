import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyTrustedDeviceSecret} from './deviceCredentials.mjs';
import {createBridgeOwnerEnrollmentHandler} from './ownerEnrollment.mjs';
import {createBridgeLoopbackTestServer} from './loopbackHttp.mjs';
const OWNER='11111111-1111-4111-8111-111111111111';
const DEVICE='22222222-2222-4222-8222-222222222222';
const OTHER='33333333-3333-4333-8333-333333333333';
const TOKEN='a'.repeat(40);
function setup(){
  let approved=true;
  const calls=[];
  const rows=new Map();
  const authClient={auth:{async getUser(t){
    return {data:{user:t===TOKEN?{id:OWNER,is_anonymous:false}:null},error:null};
  }}};
  const profilesClient={from(table){
    assert.equal(table,'profiles');
    return {select(columns){
      assert.equal(columns,'id,role,status');
      return {eq(column,id){
        assert.equal(column,'id');
        return {async maybeSingle(){
          return {data:id===OWNER?{id:OWNER,role:'user',
            status:approved?'approved':'blocked'}:null,error:null};
        }};
      }};
    }};
  }};
  const rpcClient={async rpc(name,args){
    calls.push({name,args});
    if(name==='bridge_server_enroll_device'){
      if(args.p_owner_id!==OWNER)return {data:null,error:{code:'42501'}};
      rows.set(args.p_device_id,args);return {data:args.p_device_id,error:null};
    }
    if(name==='bridge_server_delete_device'){
      const row=rows.get(args.p_device_id);
      if(row?.p_owner_id!==args.p_owner_id)return {data:null,error:{code:'42501'}};
      rows.delete(args.p_device_id);return {data:true,error:null};
    }
    return {data:null,error:{code:'wrong_operation'}};
  }};
  const handler=createBridgeOwnerEnrollmentHandler({
    authClient,profilesClient,rpcClient,newDeviceId:()=>DEVICE,
    randomBytesFn:n=>Buffer.alloc(n,n===32?0x4a:0x6b)
  });
  const request=(path,body,auth='Bearer '+TOKEN)=>handler({
    method:'POST',path,headers:{authorization:auth},body
  });
  return {request,calls,rows,setApproved:v=>{approved=v;},handler};
}
test('owner gets a one-time distinct device credential; persisted data is verifier only',async()=>{
  const f=setup();
  const answer=await f.request('/bridge/owner/enroll',{label:' Telefono personale '});
  assert.equal(answer.status,201);
  assert.equal(answer.body.deviceId,DEVICE);
  assert.match(answer.body.deviceSecret,/^[0-9a-f]{64}$/);
  const db=f.calls[0];
  assert.equal(db.name,'bridge_server_enroll_device');
  assert.equal(db.args.p_owner_id,OWNER);
  assert.equal(db.args.p_label,'Telefono personale');
  assert.equal(db.args.p_device_id,DEVICE);
  assert.equal(Object.values(db.args).includes(answer.body.deviceSecret),false);
  assert.equal(verifyTrustedDeviceSecret({
    deviceId:DEVICE,secret:answer.body.deviceSecret,
    salt:db.args.p_salt_hex,verifier:db.args.p_verifier_hex
  }),true);
  assert.equal((await f.request('/bridge/owner/delete',{deviceId:DEVICE})).status,200);
  assert.equal(f.rows.size,0);
});
test('missing token, unapproved owner and invalid body never touch privileged DB',async()=>{
  const f=setup();
  assert.equal((await f.request('/bridge/owner/enroll',{label:'a'},null)).status,401);
  assert.equal((await f.request('/bridge/owner/enroll',{label:'a'},'Bearer '+'z'.repeat(40))).status,403);
  f.setApproved(false);
  assert.equal((await f.request('/bridge/owner/enroll',{label:'a'})).status,403);
  f.setApproved(true);
  for(const body of [{label:'../bad\n'},{label:''},{label:'a',ownerId:OTHER},{label:0},{label:'x'.repeat(101)}])
    assert.equal((await f.request('/bridge/owner/enroll',body)).status,400);
  assert.equal((await f.request('/bridge/owner/delete',{deviceId:OTHER,ownerId:OWNER})).status,400);
  assert.equal(f.calls.length,0);
});
test('one owner cannot delete another device; no guessed ID leaks owner',async()=>{
  const f=setup();
  assert.equal((await f.request('/bridge/owner/delete',{deviceId:OTHER})).status,403);
  assert.equal(f.calls.length,1);
});
test('HTTP rejects unauthenticated enrollment and preserves legacy routes',async t=>{
  const f=setup();
  const server=createBridgeLoopbackTestServer({
    handler:async()=>({status:404,body:{error:'not_found'}}),
    ownerHandler:f.handler
  });
  const url=await server.start();t.after(()=>server.stop());
  const post=async(path,body,auth='')=>{
    const r=await fetch(url+path,{
      method:'POST',headers:{'content-type':'application/json',
        ...(auth?{authorization:auth}:{})},body:JSON.stringify(body)
    });
    return {status:r.status,body:await r.json()};
  };
  assert.equal((await post('/bridge/owner/enroll',{label:'x'})).status,401);
  assert.equal((await post('/bridge/owner/enroll',{label:'My phone'},'Bearer '+TOKEN)).status,201);
  assert.equal((await post('/bridge/admin/list',{})).status,404);
  assert.equal((await post('/bridge/owner/delete',{deviceId:DEVICE},'Bearer '+TOKEN)).status,200);
});

test('approved anonymous FreePT owner may enroll, pending anonymous owner remains denied',async()=>{
  const f=setup();
  // Existing fixture uses the same verified account and approved profile.
  // A separate anonymous auth fixture exercises the production signup mode.
  const authClient={auth:{async getUser(){return {data:{user:{id:OWNER,is_anonymous:true}},error:null};}}};
  let approved=true;
  const profilesClient={from(){return {select(){return {eq(){return {async maybeSingle(){return {data:{id:OWNER,role:'user',status:approved?'approved':'pending'},error:null};}};}};}};}};
  let rpcCalls=0;
  const handler=createBridgeOwnerEnrollmentHandler({authClient,profilesClient,
    rpcClient:{async rpc(name,args){rpcCalls++;return {data:args.p_device_id,error:null};}},
    newDeviceId:()=>DEVICE,randomBytesFn:n=>Buffer.alloc(n,1)
  });
  const request=()=>handler({method:'POST',path:'/bridge/owner/enroll',headers:{authorization:'Bearer '+TOKEN},body:{label:'Phone'}});
  assert.equal((await request()).status,201);
  assert.equal(rpcCalls,1);
  approved=false;
  assert.equal((await request()).status,403);
  assert.equal(rpcCalls,1);
});
