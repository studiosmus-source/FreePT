import test from 'node:test';
import assert from 'node:assert/strict';
import {createBridgeDesktopWorker} from './worker.mjs';

const DEVICE='11111111-1111-4111-8111-111111111111';
const SECRET='a'.repeat(64);
const TOKEN='b'.repeat(64);

function waitFor(check,timeoutMs=1000){
  return new Promise((resolve,reject)=>{
    const started=Date.now();
    const timer=setInterval(()=>{
      if(check()){clearInterval(timer);resolve();return;}
      if(Date.now()-started>timeoutMs){clearInterval(timer);reject(Error('timeout'));}
    },5);
  });
}

test('background worker polls with idle backoff and stops cleanly',async()=>{
  const calls=[],delays=[],states=[];
  const worker=createBridgeDesktopWorker({
    baseUrl:'https://bridge-test.example.test',deviceId:DEVICE,
    getDeviceSecret:async()=>SECRET,folderProvider:{list:async()=>({entries:[],nextOffset:-1})},
    fetchImpl:async(url,options)=>{
      const action=url.split('/').at(-1);
      calls.push(action);
      if(action==='connect')return {ok:true,json:async()=>({token:TOKEN,expiresAt:Date.now()+60_000})};
      if(action==='poll')return {ok:true,json:async()=>({job:null})};
      if(action==='disconnect')return {ok:true,json:async()=>({closed:true})};
      throw Error('unexpected_route');
    },
    sleep:async(ms,signal)=>{
      delays.push(ms);
      if(signal.aborted)return;
      await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));
    },
    onState:state=>states.push(state)
  });
  worker.start();
  await waitFor(()=>calls.includes('poll'));
  assert.deepEqual(delays,[2000]);
  assert.equal(worker.status().connected,true);
  await worker.stop();
  assert.equal(worker.status().running,false);
  assert.equal(worker.status().connected,false);
  assert.ok(calls.includes('disconnect'));
  assert.ok(states.some(state=>state.running&&state.connected));
});

test('denied credentials stop the worker instead of retrying in background',async()=>{
  const calls=[];
  const worker=createBridgeDesktopWorker({
    baseUrl:'https://bridge-test.example.test',deviceId:DEVICE,
    getDeviceSecret:async()=>SECRET,folderProvider:{list:async()=>({entries:[],nextOffset:-1})},
    fetchImpl:async(url)=>{
      calls.push(url.split('/').at(-1));
      return {ok:false,status:403};
    },
    sleep:async()=>{throw Error('must_not_retry')},
    onState:()=>{}
  });
  worker.start();
  await waitFor(()=>worker.status().running===false);
  assert.deepEqual(calls,['connect']);
  assert.equal(worker.status().lastError,'denied');
});
