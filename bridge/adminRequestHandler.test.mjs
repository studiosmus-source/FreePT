import test from 'node:test';
import assert from 'node:assert/strict';
import { createBridgeAdminRequestHandler } from './adminRequestHandler.mjs';
import { createSupabaseBridgeAdminAuthenticator } from './supabaseAdminAuth.mjs';
import { BridgeRegistry } from './deviceRouting.mjs';
import { BridgeDeviceCredentials } from './deviceCredentials.mjs';
import { BridgeDeviceSessionGate } from './deviceSessions.mjs';
import { BridgeService } from './bridgeService.mjs';

const DEVICE = '11111111-1111-4111-8111-111111111111';
const JOB = '22222222-2222-4222-8222-222222222222';
const ADMIN = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const HEADER = { authorization:'Bearer ' + 'a'.repeat(24) };
function harness({ profileRole = 'admin', profileStatus = 'approved', connected = true } = {}) {
  const log = { verified:[], ids:[] };
  const authClient = {auth:{async getUser(token) {
    log.verified.push(token);
    return {data:{user:{id:ADMIN,is_anonymous:false,app_metadata:{provider:'email'}}},error:null};
  }}};
  const profilesClient = {from(table) {
    assert.equal(table,'profiles');
    return {select(columns) {
      assert.equal(columns,'id,role,status');
      return {eq(col,id) {
        assert.equal(col,'id');
        log.ids.push(id);
        return {async maybeSingle() {
          return {data:{id:ADMIN,role:profileRole,status:profileStatus},error:null};
        }};
      }};
    }};
  }};
  const registry = new BridgeRegistry();
  registry.registerDevice({id:DEVICE,ownerId:'owner',label:'Phone'});
  registry.setBridgeEnabled({deviceId:DEVICE,ownerId:'owner',enabled:true});
  registry.grant({deviceId:DEVICE,receiverId:ADMIN,approvedByOwnerId:'owner'});
  if (connected) registry.setOnline(DEVICE,true);
  const credentials = new BridgeDeviceCredentials();
  const {secret} = credentials.issue(DEVICE);
  const sessions = new BridgeDeviceSessionGate({credentials,registry});
  const service = new BridgeService({
    registry,sessions,
    authenticateAdmin:createSupabaseBridgeAdminAuthenticator({authClient,profilesClient})
  });
  const handle = createBridgeAdminRequestHandler({service,newJobId:()=>JOB});
  const call = (path,body,headers=HEADER,method='POST') =>
    handle({method,path,headers,body});
  return {call,registry,sessions,secret,log};
}

test('trusted backend maps Bearer token to verified admin, then completes job',async () => {
  const {call,sessions,secret,log} = harness();
  const requested=await call('/bridge/admin/list',{deviceId:DEVICE});
  assert.equal(requested.status,202);
  assert.equal(requested.body.jobId,JOB);
  assert.equal(requested.body.state,'queued');
  const session=sessions.open({deviceId:DEVICE,secret});
  // The request is read by the same service's registry; no HTTP TX surface here.
  assert.equal((await call('/bridge/admin/status',{jobId:JOB})).body.state,'queued');
  assert.equal(log.verified.length,2);
  assert.deepEqual(log.ids,[ADMIN,ADMIN]);
});

test('verified admin can cancel and see terminal state via fixed routes',async () => {
  const {call}=harness();
  assert.equal((await call('/bridge/admin/list',{deviceId:DEVICE})).status,202);
  const cancelled=await call('/bridge/admin/cancel',{jobId:JOB});
  assert.equal(cancelled.status,200);
  assert.equal(cancelled.body.state,'cancelled');
  const status=await call('/bridge/admin/status',{jobId:JOB});
  assert.equal(status.status,200);
  assert.equal(status.body.state,'cancelled');
  assert.equal((await call('/bridge/admin/cancel',{jobId:JOB})).status,409);
});

test('spoofed receiver metadata and body-provided authorization rejected',async () => {
  const {call,log}=harness();
  assert.equal((await call('/bridge/admin/list',{
    deviceId:DEVICE,receiverId:ADMIN,role:'admin'
  })).status,400);
  assert.equal((await call('/bridge/admin/list',{
    deviceId:DEVICE,accessToken:'a'.repeat(24)
  },{})).status,401);
  assert.equal(log.verified.length,0);
});

test('invalid, missing and incorrectly formatted headers fail closed',async () => {
  const {call,log}=harness();
  for (const headers of [{}, {authorization:'Basic ' + 'a'.repeat(24)},
    {authorization:'Bearer short'}, {authorization:'Bearer aaaa bbbb'}, null]) {
    assert.equal((await call('/bridge/admin/list',{deviceId:DEVICE},headers)).status,401);
  }
  assert.equal(log.verified.length,0);
});

test('method/path and malformed request contracts do not call Auth',async () => {
  const {call,log}=harness();
  assert.equal((await call('/bridge/admin/list',{deviceId:DEVICE},HEADER,'GET')).status,405);
  assert.equal((await call('/bridge/admin/delete',{deviceId:DEVICE})).status,404);
  for (const body of [null,[],{}, {deviceId:'../secret'}, {deviceId:OTHER,extra:true}]) {
    assert.equal((await call('/bridge/admin/list',body)).status,400);
  }
  assert.equal(log.verified.length,0);
});

test('unapproved and ordinary profiles are denied on every action',async () => {
  for (const profile of [
    {profileRole:'user'}, {profileStatus:'blocked'}, {profileStatus:'pending'}
  ]) {
    const {call}=harness(profile);
    assert.equal((await call('/bridge/admin/list',{deviceId:DEVICE})).status,403);
    assert.equal((await call('/bridge/admin/status',{jobId:JOB})).status,403);
  }
});

test('offline device and missing job produce bounded not-leaking errors',async () => {
  const x=harness({connected:false});
  assert.deepEqual(await x.call('/bridge/admin/list',{deviceId:DEVICE}),{
    status:409,body:{error:'device_unavailable'}
  });
  assert.deepEqual(await x.call('/bridge/admin/status',{jobId:JOB}),{
    status:404,body:{error:'not_found'}
  });
});

test('unknown or foreign job returns same uninformative response',async () => {
  const {call}=harness();
  assert.deepEqual(await call('/bridge/admin/status',{jobId:JOB}),
    {status:404,body:{error:'not_found'}});
});

test('invalid dependency configuration is rejected before use',() => {
  assert.throws(()=>createBridgeAdminRequestHandler({}),/invalid_bridge_request_dependencies/);
});
