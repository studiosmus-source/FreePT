import test from 'node:test';
import assert from 'node:assert/strict';
import {createBridgeFolderTransmitter} from '../src/bridgeTxFolderClient.js';
const DEVICE='11111111-1111-4111-8111-111111111111';
const JOB='22222222-2222-4222-8222-222222222222';
const HANDLE='33333333-3333-4333-8333-333333333333';
const SECRET='a'.repeat(64),TOKEN='b'.repeat(64);
const entry={handle:HANDLE,name:'Foto',directory:true,size:-1,mime:'vnd.android.document/directory'};
function fixture({poll={job:{jobId:JOB,deviceId:DEVICE,state:'sent',operation:'list'}},
  folder={entries:[entry],nextOffset:-1}}={}){
  const calls=[];
  const fakeFetch=async (url,request)=>{
    const action=url.split('/').at(-1);
    calls.push({action,body:JSON.parse(request.body),url,request});
    if(action==='connect')return {ok:true,json:async()=>({token:TOKEN,expiresAt:Date.now()+60000})};
    if(action==='poll')return {ok:true,json:async()=>poll};
    if(action==='folder')return {ok:true,json:async()=>({jobId:JOB,deviceId:DEVICE,state:'done'})};
    if(action==='disconnect')return {ok:true,json:async()=>({closed:true})};
    throw Error('unexpected_route');
  };
  const reads=[];
  const tx=createBridgeFolderTransmitter({
    baseUrl:'https://bridge-test.example.test',deviceId:DEVICE,deviceSecret:SECRET,
    folderProvider:{async list(request){reads.push(request);return folder;}},
    fetchImpl:fakeFetch
  });
  return {tx,calls,reads};
}
test('no auto-start, TX must connect and only selected root is read',async()=>{
  const f=fixture();
  await assert.rejects(()=>f.tx.processOne(),/not_connected/);
  assert.equal(f.calls.length,0);
  await f.tx.connect();
  assert.equal(await f.tx.processOne(),true);
  assert.deepEqual(f.reads,[{handle:'root',offset:0}]);
  assert.deepEqual(f.calls.map(x=>x.action),['connect','poll','folder']);
  assert.deepEqual(f.calls[2].body.entries,[entry]);
  assert.equal(f.calls[2].body.sessionToken,TOKEN);
  assert.equal(f.calls[0].request.redirect,'error');
  assert.equal(await f.tx.disconnect(),true);
  await assert.rejects(()=>f.tx.processOne(),/not_connected|disabled/);
});
test('zero jobs and mismatched TX device never trigger folder reads',async()=>{
  const empty=fixture({poll:{job:null}});
  await empty.tx.connect();
  assert.equal(await empty.tx.processOne(),false);
  assert.deepEqual(empty.reads,[]);
  const wrong=fixture({poll:{job:{jobId:JOB,deviceId:JOB,state:'sent',operation:'list'}}});
  await wrong.tx.connect();
  await assert.rejects(()=>wrong.tx.processOne(),/wrong_device/);
  assert.deepEqual(wrong.reads,[]);
});
test('incomplete pagination or malformed name fails closed without submitting',async()=>{
  for(const folder of [
    {entries:[entry],nextOffset:100},
    {entries:[{...entry,name:'../secret'}],nextOffset:-1}
  ]){
    const f=fixture({folder});await f.tx.connect();
    await assert.rejects(()=>f.tx.processOne(),/bridge_file/);
    assert.equal(f.calls.some(x=>x.action==='folder'),false);
  }
});
test('unsafe credentials or endpoint rejected at creation',()=>{
  for(const options of [
    {baseUrl:'http://test.example',deviceId:DEVICE,deviceSecret:SECRET},
    {baseUrl:'https://cpopqsvzzxfjgnlawlvc.supabase.co',deviceId:DEVICE,deviceSecret:SECRET},
    {baseUrl:'https://bridge-test.example.test',deviceId:'bad',deviceSecret:SECRET},
    {baseUrl:'https://bridge-test.example.test',deviceId:DEVICE,deviceSecret:'bad'}
  ])assert.throws(()=>createBridgeFolderTransmitter({
    ...options,folderProvider:{list(){}}
  }),/not_provisioned/);
});
