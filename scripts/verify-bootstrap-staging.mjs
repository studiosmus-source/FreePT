/** Explicit live test: creates one consented synthetic pending device, then cancels it.
 * Never accesses files or personal accounts. No tokens or pairing codes are logged.
 */
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,randomBytes,randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {bootstrapMessage} from '../bridge/bootstrapProtocol.mjs';
const url='https://freept-bridge-staging.onrender.com';
if(process.env.FREEPT_LIVE_STAGING_PROBE!=='CREATE_AND_CANCEL_SYNTHETIC_DEVICE')
 throw Error('Explicit staging probe opt-in required');
const {publicKey,privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const id=randomUUID(),pairCode=randomBytes(6).toString('hex');
const spki=publicKey.export({type:'spki',format:'der'}).toString('base64');
const checks=[];
const envelope=(action,payload={})=>{
 const e={deviceId:id,timestamp:Date.now(),nonce:randomBytes(16).toString('hex'),payload:JSON.stringify(payload)};
 e.signature=sign('sha256',Buffer.from(bootstrapMessage(action,e)),privateKey).toString('base64');return e;
};
async function post(action,body,headers={}){
 const r=await fetch(url+'/bridge/bootstrap/'+action,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body),signal:AbortSignal.timeout(55000)});
 return {status:r.status,body:await r.json(),origin:r.headers.get('access-control-allow-origin')};
}
function check(name,actual,expected){assert.deepEqual(actual,expected,name);checks.push({name,result:'PASS'});}
let created=false,cancelled=false;
try{
 const health=await fetch(url+'/health',{signal:AbortSignal.timeout(55000)});
 check('HTTPS health', [health.status,await health.json()],[200,{status:'ok'}]);
 check('Anonymous admin approval denied',(await post('approve',{pairCode})).status,403);
 check('Invalid Auth token denied',(await post('approve',{pairCode},{authorization:'Bearer staging-invalid-token-probe-only'})).status,403);
 check('Foreign browser origin denied',(await post('start',{}, {origin:'https://untrusted.invalid'})).body,{error:'origin_denied'});
 const start=envelope('start',{publicKey:spki,pairCode,consent:true});
 const corrupted={...start,payload:start.payload.replace('true','false')};
 check('Altered signature denied',(await post('start',corrupted)).body,{error:'bootstrap_device_proof_required'});
 const stale={...start,timestamp:Date.now()-120000};
 stale.signature=sign('sha256',Buffer.from(bootstrapMessage('start',stale)),privateKey).toString('base64');
 check('Expired signed envelope denied',(await post('start',stale)).status,403);
 const begun=await post('start',start,{origin:'https://localhost'});
 check('Signed pre-account pending',[begun.status,begun.body,begun.origin],[200,{state:'pending'},'https://localhost']);created=true;
 check('Persistent start replay denied',(await post('start',start)).status,403);
 const poll=await post('poll',envelope('poll'));
 check('No diagnostic before admin approval',[poll.status,poll.body],[200,{state:'pending'}]);
 check('Missing personal login denied',(await post('claim',envelope('claim',{deviceSecret:randomBytes(32).toString('hex'),accountProof:'invalid'}))).status,401);
 const stop=await post('cancel',envelope('cancel'));
 check('Signed cancellation',[stop.status,stop.body],[200,{cancelled:true}]);cancelled=true;
 check('Cancelled device fenced',(await post('status',envelope('status'))).status,403);
}finally{
 if(created&&!cancelled){const r=await post('cancel',envelope('cancel'));cancelled=r.status===200;}
 const report={timestamp:new Date().toISOString(),target:url,level:'live HTTPS + staging Supabase RPC; Node P-256 client, not Android Keystore',checks,syntheticDevice:{id,created,cancelled},notExecuted:['Valid Supabase admin login and approval','Synthetic transfer after authenticated approval','Personal Auth claim','Android/Oppo physical Keystore and SAF'],completeEndToEnd:false};
 await writeFile('reports/FreePT-live-HTTPS-2026-11-19.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
}
