import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,randomUUID,randomBytes} from 'node:crypto';
import {createBootstrapHandler} from './bootstrapHandler.mjs';
import {bootstrapMessage} from './bootstrapProtocol.mjs';
function setup(enabled=true){
 let rpc=0,auth=0;
 const db={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:null,error:null})})})}),rpc:async()=>{rpc++;return {data:{state:'pending'},error:null};}};
 const h=createBootstrapHandler({enabled,db,authClient:{auth:{getUser:async()=>{auth++;return {data:{user:null},error:null};}}}});
 return {h,counts:()=>({rpc,auth})};
}
function start(body){
 const k=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
 const publicKey=k.publicKey.export({type:'spki',format:'der'}).toString('base64');
 const e={deviceId:randomUUID(),timestamp:Date.now(),nonce:randomBytes(16).toString('hex'),payload:JSON.stringify({publicKey,pairCode:'abcdef123456',consent:true,...body})};
 e.signature=sign('sha256',Buffer.from(bootstrapMessage('start',e)),k.privateKey).toString('base64');
 return {method:'POST',path:'/bridge/bootstrap/start',body:e};
}
test('disabled bootstrap denies without auth, SQL or a personal session',async()=>{
 const f=setup(false);assert.equal((await f.h(start({}))).status,404);assert.deepEqual(f.counts(),{rpc:0,auth:0});
});
test('self-signed start needs explicit consent and rejects caller-supplied roles',async()=>{
 for(const body of [{consent:false},{role:'admin'},{ownerId:randomUUID()}]){
  const f=setup();assert.equal((await f.h(start(body))).status,400);assert.deepEqual(f.counts(),{rpc:0,auth:0});
 }
 const f=setup();assert.equal((await f.h(start({}))).status,200);assert.deepEqual(f.counts(),{rpc:1,auth:0});
});
test('tampering and unauthorized admin approval never reach a privileged mutation',async()=>{
 const f=setup(),r=start({});r.body.payload='{}';assert.equal((await f.h(r)).status,403);
 assert.equal((await f.h({method:'POST',path:'/bridge/bootstrap/approve',headers:{authorization:'Bearer '+'z'.repeat(40)},body:{pairCode:'abcdef123456'}})).status,403);
 assert.equal(f.counts().rpc,0);
});
