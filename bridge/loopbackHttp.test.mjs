import test from 'node:test';
import assert from 'node:assert/strict';
import { createBridgeLoopbackTestServer } from './loopbackHttp.mjs';
import { createBridgeAdminRequestHandler } from './adminRequestHandler.mjs';
import { createSupabaseBridgeAdminAuthenticator } from './supabaseAdminAuth.mjs';
import { BridgeRegistry } from './deviceRouting.mjs';
import { BridgeDeviceCredentials } from './deviceCredentials.mjs';
import { BridgeDeviceSessionGate } from './deviceSessions.mjs';
import { BridgeService } from './bridgeService.mjs';

const DEVICE='11111111-1111-4111-8111-111111111111';
const JOB='22222222-2222-4222-8222-222222222222';
const ADMIN='33333333-3333-4333-8333-333333333333';
const TOKEN='a'.repeat(32);

function makeHandler({role='admin',status='approved'}={}) {
  const authClient={auth:{async getUser(token){
    if(token!==TOKEN) return {data:{user:null},error:{message:'invalid_token'}};
    return {data:{user:{id:ADMIN,is_anonymous:false}},error:null};
  }}};
  const profilesClient={from(table){
    assert.equal(table,'profiles');
    return {select(columns){
      assert.equal(columns,'id,role,status');
      return {eq(column,id){
        assert.equal(column,'id');
        assert.equal(id,ADMIN);
        return {async maybeSingle(){return {data:{id:ADMIN,role,status},error:null};}};
      }};
    }};
  }};
  const registry=new BridgeRegistry();
  registry.registerDevice({id:DEVICE,ownerId:'owner',label:'TX'});
  registry.grant({deviceId:DEVICE,receiverId:ADMIN,approvedByOwnerId:'owner'});
  registry.setBridgeEnabled({deviceId:DEVICE,ownerId:'owner',enabled:true});
  const credentials=new BridgeDeviceCredentials();
  const {secret}=credentials.issue(DEVICE);
  const sessions=new BridgeDeviceSessionGate({credentials,registry});
  const service=new BridgeService({
    registry,sessions,
    authenticateAdmin:createSupabaseBridgeAdminAuthenticator({authClient,profilesClient})
  });
  const handler=createBridgeAdminRequestHandler({service,newJobId:()=>JOB});
  return {handler,service,secret};
}
async function post(url,path,payload,token=TOKEN) {
  const r=await fetch(url+path,{
    method:'POST',
    headers:{'content-type':'application/json',authorization:'Bearer '+token},
    body:JSON.stringify(payload)
  });
  return {status:r.status,body:await r.json(),headers:r.headers};
}

test('loopback HTTP full admin list, TX dispatch, completion and status',async t=>{
  const {handler,service,secret}=makeHandler();
  const srv=createBridgeLoopbackTestServer({handler});
  const url=await srv.start(); t.after(()=>srv.stop());
  const tx=service.connectDevice({deviceId:DEVICE,deviceSecret:secret});
  const queued=await post(url,'/bridge/admin/list',{deviceId:DEVICE});
  assert.equal(queued.status,202);
  assert.equal(queued.body.jobId,JOB);
  assert.equal(service.pollDevice({deviceId:DEVICE,sessionToken:tx.token}).jobId,JOB);
  assert.equal(service.completeDevice({deviceId:DEVICE,sessionToken:tx.token,jobId:JOB}).state,'done');
  assert.equal((await post(url,'/bridge/admin/status',{jobId:JOB})).body.state,'done');
  assert.equal(queued.headers.get('cache-control'),'no-store');
});

test('loopback rejects unapproved role, invalid bearer and wrong JSON',async t=>{
  const srv=createBridgeLoopbackTestServer({handler:makeHandler({role:'user'}).handler});
  const url=await srv.start();t.after(()=>srv.stop());
  assert.equal((await post(url,'/bridge/admin/list',{deviceId:DEVICE})).status,403);
  assert.equal((await post(url,'/bridge/admin/list',{deviceId:DEVICE},'b'.repeat(32))).status,403);
  const invalid=await fetch(url+'/bridge/admin/list',{method:'POST',headers:{'content-type':'application/json'},body:'{'});
  assert.equal(invalid.status,400);
  assert.deepEqual(await invalid.json(),{error:'invalid_json'});
  const noType=await fetch(url+'/bridge/admin/list',{method:'POST',body:'{}'});
  assert.equal(noType.status,415);
  assert.deepEqual(await noType.json(),{error:'unsupported_media_type'});
});

test('loopback blocks unsupported routes, methods and oversized bodies',async t=>{
  const srv=createBridgeLoopbackTestServer({handler:makeHandler().handler});
  const url=await srv.start();t.after(()=>srv.stop());
  assert.equal((await fetch(url+'/bridge/admin/list')).status,405);
  assert.equal((await post(url,'/bridge/admin/read',{deviceId:DEVICE})).status,404);
  const oversized=await post(url,'/bridge/admin/list',{deviceId:DEVICE,padding:'x'.repeat(2200)});
  assert.equal(oversized.status,413);
  assert.deepEqual(oversized.body,{error:'payload_too_large'});
  const exactLimit=await fetch(url+'/bridge/admin/list',{
    method:'POST',headers:{'content-type':'application/json'},
    body:' '.repeat(2048)
  });
  assert.equal(exactLimit.status,400);
  assert.deepEqual(await exactLimit.json(),{error:'invalid_json'});
});

test('loopback does not expose a public bind address or fixed port',async t=>{
  const srv=createBridgeLoopbackTestServer({handler:makeHandler().handler});
  const url=await srv.start();t.after(()=>srv.stop());
  assert.match(url,/^http:\/\/127\.0\.0\.1:\d+$/);
  assert.ok(Number(new URL(url).port)>0);
  await assert.rejects(()=>srv.start(),/already_started/);
});

test('loopback requires trusted injected handler',()=>{
  assert.throws(()=>createBridgeLoopbackTestServer({}),/invalid_http_handler/);
});
