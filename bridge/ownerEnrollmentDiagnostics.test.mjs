import test from 'node:test';
import assert from 'node:assert/strict';
import {createBridgeOwnerEnrollmentHandler} from './ownerEnrollment.mjs';
const ID='11111111-1111-4111-8111-111111111111';
const TOKEN='a'.repeat(40);
for(const scenario of ['invalid_token','profile_query_failed','profile_missing','profile_not_approved','profile_role_invalid','exception']){
  test('safe enrollment diagnostic: '+scenario,async()=>{
    const reasons=[];
    const handler=createBridgeOwnerEnrollmentHandler({
      authClient:{auth:{async getUser(){
        if(scenario==='exception')throw Error('secret-value');
        return {data:{user:scenario==='invalid_token'?null:{id:ID,is_anonymous:false}},error:null};
      }}},
      profilesClient:{from(){return {select(){return {eq(){return {async maybeSingle(){
        if(scenario==='profile_query_failed')return {data:null,error:{message:'secret-value'}};
        if(scenario==='profile_missing')return {data:null,error:null};
        return {data:{id:ID,status:scenario==='profile_not_approved'?'pending':'approved',role:scenario==='profile_role_invalid'?'guest':'user'},error:null};
      }}}}}}}},
      rpcClient:{async rpc(){throw Error('must not enroll');}},
      onAuthDiagnostic:reason=>reasons.push(reason)
    });
    const response=await handler({method:'POST',path:'/bridge/owner/enroll',headers:{authorization:'Bearer '+TOKEN},body:{label:'Phone'}});
    assert.equal(response.status,403);
    assert.deepEqual(reasons,[scenario==='invalid_token'?'token_invalid_or_anonymous':scenario==='exception'?'auth_or_profile_exception':scenario]);
    assert.equal(JSON.stringify(reasons).includes('secret-value'),false);
  });
}
