import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const entry=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const start=entry.indexOf('async function unlockAdmin(){');
const end=entry.indexOf('\nconst esc =',start);
assert.ok(start>=0&&end>start,'FreePT unlockAdmin must be present');
const source=entry.slice(start,end);
function harness({native,user={id:'admin-uid',is_anonymous:false},profile={role:'admin',status:'approved'}}={}){
  const context={adminUnlocked:false,me:user,profile,
    Capacitor:{isNativePlatform:()=>native}};
  runInNewContext(source+'\nthis.invokeUnlock=unlockAdmin;',context);
  return context;
}

test('authorized admin enters on browser without device biometrics',async()=>{
  const c=harness({native:false});
  assert.equal(await c.invokeUnlock(),true);
  assert.equal(c.adminUnlocked,true);
});
test('authorized admin enters on native Android without biometric prompt',async()=>{
  const c=harness({native:true});
  assert.equal(await c.invokeUnlock(),true);
  assert.equal(c.adminUnlocked,true);
  assert.doesNotMatch(source,/NativeBiometric|verifyIdentity/);
});
test('anonymous, pending and non-admin accounts never gain admin access',async()=>{
  for(const options of [
    {user:null},
    {user:{id:'anon',is_anonymous:true}},
    {profile:{role:'user',status:'approved'}},
    {profile:{role:'admin',status:'pending'}},
    {profile:null}
  ]){
    const c=harness(options);
    assert.equal(await c.invokeUnlock(),false);
    assert.equal(c.adminUnlocked,false);
  }
});
