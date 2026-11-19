import test from 'node:test';
import assert from 'node:assert/strict';
import {authE2EEnabled,runStagingAuthE2E,AUTH_E2E_RUN} from './stagingAuthE2E.mjs';
const config={url:'https://aqjuixbuxftnjfzxmzuj.supabase.co',publishable:'public',serviceKey:'SERVER_SECRET_DO_NOT_EXPOSE'};
const env={FREEPT_BRIDGE_AUTH_E2E:AUTH_E2E_RUN,FREEPT_BRIDGE_BOOTSTRAP:'STAGING_DEVICE_KEY_V1',FREEPT_BRIDGE_TEST_CONSOLE:'AUTH_E2E_ONLY'};
test('fixture provisioning requires exact explicit run, exact test project and all staging gates',()=>{
 assert.equal(authE2EEnabled({},config),false);assert.equal(authE2EEnabled(env,config),true);
 assert.throws(()=>authE2EEnabled(env,{...config,url:'https://cpopqsvzzxfjgnlawlvc.supabase.co'}));
 assert.throws(()=>authE2EEnabled({...env,FREEPT_BRIDGE_BOOTSTRAP:''},config));
 assert.throws(()=>authE2EEnabled({...env,FREEPT_BRIDGE_TEST_CONSOLE:''},config));
});
test('runner independently refuses production before constructing clients',async()=>{
 let touched=false;await assert.rejects(runStagingAuthE2E({config:{...config,url:'https://cpopqsvzzxfjgnlawlvc.supabase.co'},publish:()=>{},clientFactory:()=>{touched=true;}}));assert.equal(touched,false);
});
test('existing fixture account conflict fails closed without resetting password or profile',async()=>{
 let creates=0;const reports=[];
 const clientFactory=()=>({auth:{admin:{createUser:async data=>{creates++;assert.ok(data.password.length>=48);assert.equal(data.email_confirm,true);return {error:{message:'already exists'}};}},signInWithPassword:()=>{throw Error('must not log into existing account')},signOut:async()=>({error:null})}});
 const result=await runStagingAuthE2E({config,publish:r=>reports.push(r),clientFactory,fetchFn:async()=>({ok:true,json:async()=>({run:AUTH_E2E_RUN})}),wait:async()=>{}});
 assert.equal(creates,1);assert.equal(result.completeEndToEnd,false);assert.equal(result.failure,'Official Auth Admin API creates NEW admin');
 assert.ok(!JSON.stringify(reports).includes(config.serviceKey));assert.ok(!JSON.stringify(reports).includes('@tests.freept.invalid'));
});
test('unexpected SDK failure cannot export secret error messages',async()=>{
 const result=await runStagingAuthE2E({config,publish:()=>{},clientFactory:()=>({auth:{admin:{createUser:async()=>{throw Error(config.serviceKey)}},signOut:async()=>({})}}),fetchFn:async()=>({ok:true,json:async()=>({run:AUTH_E2E_RUN})})});
 assert.equal(result.failure,'unexpected_runtime_error');assert.ok(!JSON.stringify(result).includes(config.serviceKey));
});
