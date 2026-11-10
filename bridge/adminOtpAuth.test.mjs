import test from 'node:test';
import assert from 'node:assert/strict';
import {sendAdminEmailCode,verifyAdminEmailCode,adminOtpFailureMessage} from '../src/adminOtpAuth.js';

const email='owner@example.test';
test('passwordless admin code never auto-creates users',async()=>{
  const calls=[];
  const auth={async signInWithOtp(input){calls.push(input);return {error:null};}};
  assert.equal(await sendAdminEmailCode(auth,'  OWNER@example.test '),email);
  assert.deepEqual(calls,[{email,options:{shouldCreateUser:false}}]);
});
test('passwordless admin rejects malformed email before API call',async()=>{
  let called=false;
  const auth={async signInWithOtp(){called=true;return {error:null};}};
  for(const value of ['', 'not-an-email','a b@example.test','name@','a'.repeat(260)+'@x.test'])
    await assert.rejects(()=>sendAdminEmailCode(auth,value),/admin_email_invalid/);
  assert.equal(called,false);
});
test('passwordless admin verifies one-time email token',async()=>{
  const calls=[];
  const user={id:'22222222-2222-4222-8222-222222222222',is_anonymous:false};
  const auth={async verifyOtp(input){calls.push(input);return {data:{user},error:null};}};
  assert.equal(await verifyAdminEmailCode(auth,email,' 123456 '),user);
  assert.deepEqual(calls,[{email,token:'123456',type:'email'}]);
  assert.equal(await verifyAdminEmailCode(auth,email,' 12345678 '),user);
  assert.deepEqual(calls[1],{email,token:'12345678',type:'email'});
  assert.equal(await verifyAdminEmailCode(auth,email,'1234567890'),user);
});
test('passwordless admin refuses invalid tokens before network request',async()=>{
  let called=false;
  const auth={async verifyOtp(){called=true;return {data:{user:{}},error:null};}};
  for(const code of ['', '12345','12345678901','xxxxxx','1234567x'])
    await assert.rejects(()=>verifyAdminEmailCode(auth,email,code),/admin_code_invalid/);
  assert.equal(called,false);
});
test('passwordless admin rejects anonymous, missing and failed authentication',async()=>{
  for(const result of [
    {data:{user:null},error:null},
    {data:{user:{id:'anonymous',is_anonymous:true}},error:null},
    {data:null,error:{message:'bad code'}}
  ]){
    await assert.rejects(()=>verifyAdminEmailCode({
      async verifyOtp(){return result;}
    },email,'123456'),/admin_code_verification_failed/);
  }
});
test('passwordless admin does not expose provider errors or call nonexistent API',async()=>{
  await assert.rejects(()=>sendAdminEmailCode({
    async signInWithOtp(){return {error:{message:'private provider detail'}};}
  },email),/admin_code_delivery_failed/);
  await assert.rejects(()=>sendAdminEmailCode({},email),/admin_auth_unavailable/);
  await assert.rejects(()=>verifyAdminEmailCode({},email,'123456'),/admin_auth_unavailable/);
});

test('OTP disabled is explained without leaking provider errors',()=>{
  const friendly=adminOtpFailureMessage({message:'admin_code_delivery_failed:otp_disabled:HTTP_422'});
  assert.match(friendly,/OTP disattivato/);
  assert.match(friendly,/email e password/);
  assert.doesNotMatch(friendly,/HTTP_|admin_code_delivery_failed/);
});
test('other OTP failures do not leak raw server messages',()=>{
  const message=adminOtpFailureMessage({message:'secret server reason'});
  assert.match(message,/email e password/);
  assert.doesNotMatch(message,/secret server reason/);
  assert.match(adminOtpFailureMessage({message:'admin_email_invalid'}),/email valido/);
});
