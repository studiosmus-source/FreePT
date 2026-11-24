import test from 'node:test';
import assert from 'node:assert/strict';
import {obtainRequestUser,isConfirmedDeletedAuthUser} from './staleSessionRecovery.js';
const old={id:'old',is_anonymous:true},fresh={id:'new',is_anonymous:true};
test('deleted account is renewed only after server confirms absence',async()=>{
 const calls=[];
 const user=await obtainRequestUser({
  getSession:async()=>({data:{session:{user:old}}}),
  getUser:async()=>({data:{user:null},error:{status:403,code:'user_not_found'}}),
  signOut:async value=>{calls.push(value);return{error:null}},
  signInAnonymously:async()=>({data:{user:fresh},error:null})
 });
 assert.equal(user.id,'new');
 assert.deepEqual(calls,[{scope:'local'}]);
});
test('valid existing anonymous account reused unchanged',async()=>{
 let changed=false;
 const user=await obtainRequestUser({
  getSession:async()=>({data:{session:{user:old}}}),
  getUser:async()=>({data:{user:old},error:null}),
  signOut:async()=>{changed=true;throw Error('must not sign out')},
  signInAnonymously:async()=>{changed=true;throw Error('must not sign in')}
 });
 assert.equal(user.id,'old');assert.equal(changed,false);
});
test('network error does not erase active session',async()=>{
 let changed=false;
 await assert.rejects(()=>obtainRequestUser({
  getSession:async()=>({data:{session:{user:old}}}),
  getUser:async()=>({data:{user:null},error:{status:503,message:'Connection failed'}}),
  signOut:async()=>{changed=true;},
  signInAnonymously:async()=>{changed=true;}
 }),error=>error.status===503);
 assert.equal(changed,false);
 assert.equal(isConfirmedDeletedAuthUser({status:403,message:'Permission denied'}),false);
});
test('fresh installation may register without existing session',async()=>{
 const user=await obtainRequestUser({
  getSession:async()=>({data:{session:null}}),
  signInAnonymously:async()=>({data:{user:fresh},error:null})
 });
 assert.equal(user.id,'new');
});
