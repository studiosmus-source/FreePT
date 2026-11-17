import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseBridgeAdminAuthenticator } from './supabaseAdminAuth.mjs';
import { BridgeRegistry } from './deviceRouting.mjs';
import { BridgeDeviceCredentials } from './deviceCredentials.mjs';
import { BridgeDeviceSessionGate } from './deviceSessions.mjs';
import { BridgeService } from './bridgeService.mjs';

function fixture({
  user = { id:'admin-a', is_anonymous:false, app_metadata:{provider:'email'} },
  profile = { id:'admin-a', role:'admin', status:'approved' },
  authError = null, profileError = null, throwAuth = false,
  throwProfiles = false
} = {}) {
  const calls = { tokens:[], ids:[], tables:[], selections:[] };
  const authClient = { auth: { async getUser(token) {
    calls.tokens.push(token);
    if (throwAuth) throw Error('auth_service_down');
    return { data:{user}, error:authError };
  } } };
  const profilesClient = { from(table) {
    calls.tables.push(table);
    if (throwProfiles) throw Error('database_down');
    return { select(cols) {
      calls.selections.push(cols);
      return { eq(column,id) {
        assert.equal(column,'id');
        calls.ids.push(id);
        return { async maybeSingle() {return {data:profile,error:profileError};} };
      } };
    } };
  } };
  return { authClient,profilesClient,calls };
}

test('verified non-anonymous account with approved admin database role passes', async () => {
  const x = fixture();
  const verify = createSupabaseBridgeAdminAuthenticator(x);
  assert.deepEqual(await verify({accessToken:'a'.repeat(24)}), {
    id:'admin-a',role:'admin',approved:true
  });
  assert.deepEqual(x.calls.ids,['admin-a']);
  assert.deepEqual(x.calls.tables,['profiles']);
  assert.deepEqual(x.calls.selections,['id,role,status']);
});

test('client-supplied identity, metadata and role cannot bypass DB role verification', async () => {
  const x = fixture({profile:{id:'admin-a',role:'user',status:'approved'}});
  const verify = createSupabaseBridgeAdminAuthenticator(x);
  assert.equal(await verify({
    accessToken:'a'.repeat(24),id:'admin-a',role:'admin',approved:true
  }),null);
  const y = fixture({
    user:{id:'other',is_anonymous:false,user_metadata:{role:'admin'}},
    profile:{id:'admin-a',role:'admin',status:'approved'}
  });
  assert.equal(await createSupabaseBridgeAdminAuthenticator(y)({
    accessToken:'a'.repeat(24)
  }),null);
});

test('anonymous, pending and blocked accounts are denied', async () => {
  for (const overrides of [
    {user:{id:'admin-a',is_anonymous:true}},
    {user:{id:'admin-a',is_anonymous:false,app_metadata:{provider:'anonymous'}}},
    {profile:{id:'admin-a',role:'admin',status:'pending'}},
    {profile:{id:'admin-a',role:'admin',status:'blocked'}}
  ]) {
    const verify=createSupabaseBridgeAdminAuthenticator(fixture(overrides));
    assert.equal(await verify({accessToken:'a'.repeat(24)}),null);
  }
});

test('invalid token fails before any network or profile lookup', async () => {
  const x = fixture();
  const verify=createSupabaseBridgeAdminAuthenticator(x);
  for (const context of [null,{}, {accessToken:'short'},
    {accessToken:'a'.repeat(8193)}, {accessToken:'a'.repeat(21)+' '}]) {
    assert.equal(await verify(context),null);
  }
  assert.equal(x.calls.tokens.length,0);
});

test('Auth and profile failures fail closed, never fall back to claimed role', async () => {
  for (const overrides of [
    {authError:{message:'invalid JWT'}}, {user:null},
    {profileError:{message:'RLS denied'}}, {profile:null},
    {throwAuth:true}, {throwProfiles:true}
  ]) {
    const verify=createSupabaseBridgeAdminAuthenticator(fixture(overrides));
    assert.equal(await verify({accessToken:'a'.repeat(24),role:'admin'}),null);
  }
});

test('missing trusted Supabase clients are rejected', () => {
  assert.throws(() => createSupabaseBridgeAdminAuthenticator({}), /invalid_admin_auth_dependencies/);
});

test('BridgeService accepts only admin confirmed by Auth and database record', async () => {
  const x=fixture();
  const registry=new BridgeRegistry();
  registry.registerDevice({id:'tx',ownerId:'owner',label:'TX'});
  registry.setBridgeEnabled({deviceId:'tx',ownerId:'owner',enabled:true});
  registry.setOnline('tx',true);
  registry.grant({deviceId:'tx',receiverId:'admin-a',approvedByOwnerId:'owner'});
  const credentials=new BridgeDeviceCredentials();
  credentials.issue('tx');
  const service=new BridgeService({
    registry,sessions:new BridgeDeviceSessionGate({credentials,registry}),
    authenticateAdmin:createSupabaseBridgeAdminAuthenticator(x)
  });
  assert.equal((await service.requestList({
    authContext:{accessToken:'a'.repeat(24),id:'fake'},
    deviceId:'tx',jobId:'list-1'
  })).state,'queued');
  assert.equal((await service.getRequestStatus({
    authContext:{accessToken:'a'.repeat(24)},jobId:'list-1'
  })).state,'queued');
  assert.equal((await service.cancelRequest({
    authContext:{accessToken:'a'.repeat(24)},jobId:'list-1'
  })).state,'cancelled');
});
