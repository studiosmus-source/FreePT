import test from 'node:test';
import assert from 'node:assert/strict';
import {createBridgeOwnerEnrollmentHandler} from './ownerEnrollment.mjs';
const UID='11111111-1111-4111-8111-111111111111';
test('existing enrollment denies pre-account requests without invoking privileged SQL',async()=>{
 let writes=0;
 const handler=createBridgeOwnerEnrollmentHandler({
  authClient:{auth:{getUser:async()=>({data:{user:{id:UID}}})}},
  profilesClient:{from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:null,error:null})})})})},
  rpcClient:{rpc:async()=>{writes++;throw Error('must not write')}},onAuthDiagnostic:()=>{}
 });
 const request={method:'POST',path:'/bridge/owner/enroll',body:{label:'Test device'}};
 assert.equal((await handler(request)).status,401);
 assert.equal((await handler({...request,headers:{authorization:'Bearer '+'x'.repeat(40)}})).status,403);
 assert.equal(writes,0);
});
