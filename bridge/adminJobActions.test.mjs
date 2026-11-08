import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const entry=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const start=entry.indexOf('async function requestAdminBridgeList(panel,button,existingJob=null){');
const end=entry.indexOf('\nfunction showAdminBridge(){',start);
assert.ok(start>=0&&end>start,'Bridge admin job actions must exist');
const source=entry.slice(start,end);
const DEVICE='11111111-1111-4111-8111-111111111111';
const JOB='22222222-2222-4222-8222-222222222222';

function harness({pending=false}={}){
  const calls=[];
  const children=[];
  const row={
    isConnected:true,
    querySelectorAll:()=>children.filter(e=>/bridge-job-(controls|status)/.test(e.className)),
    querySelector:selector=>children.find(e=>selector==='.bridge-job-controls'&&e.className==='bridge-job-controls')||null,
    appendChild:e=>{children.push(e)}
  };
  const document={createElement:tag=>({
    tagName:tag,className:'',textContent:'',disabled:false,onclick:null,
    setAttribute(){},append(...els){this.children=els},remove(){const index=children.indexOf(this);if(index>=0)children.splice(index,1)}
  })};
  let finish;
  const bridgeClient={
    requestList:async id=>{
      calls.push(['list',id]);
      if(pending)await new Promise(resolve=>{finish=resolve});
      return {deviceId:DEVICE,jobId:JOB,state:'queued'};
    },
    getStatus:async id=>{calls.push(['status',id]);return {deviceId:DEVICE,jobId:JOB,state:'done'}},
    cancel:async id=>{calls.push(['cancel',id]);return {deviceId:DEVICE,jobId:JOB,state:'cancelled'}}
  };
  const panel={isConnected:true};
  const button={dataset:{bridgeRequest:DEVICE},parentElement:row,disabled:false};
  const bridgePendingJobs=new Map();
  const context={document,bridgeClient,profile:{role:'admin'},adminUnlocked:true,
    me:{id:'admin'},bridgePendingJobs,bridgePendingOwnerId:'admin'};
  runInNewContext(source+'\nthis.request=requestAdminBridgeList;',context);
  return {request:context.request,panel,button,row,children,calls,context,bridgePendingJobs,finish:()=>finish?.()};
}
test('Bridge admin can request, inspect and close a job without duplicate submission',async()=>{
  const h=harness();
  await h.request(h.panel,h.button);
  assert.equal(h.button.disabled,true);
  await h.request(h.panel,h.button);
  assert.equal(h.calls.filter(x=>x[0]==='list').length,1);
  const controls=h.children.find(e=>e.className==='bridge-job-controls');
  const [check,cancel]=controls.children;
  await check.onclick();
  assert.equal(h.calls.at(-1)[0],'status');
  assert.equal(h.button.disabled,false);
  assert.equal(cancel.disabled,true);
  assert.equal(h.children.find(e=>e.className==='bridge-job-status').textContent.includes('done'),true);
});
test('Bridge admin cancellation marks job terminal and re-enables new requests',async()=>{
  const h=harness();
  await h.request(h.panel,h.button);
  const controls=h.children.find(e=>e.className==='bridge-job-controls');
  await controls.children[1].onclick();
  assert.deepEqual(h.calls.map(x=>x[0]),['list','cancel']);
  assert.equal(h.button.disabled,false);
  assert.equal(controls.children[1].disabled,true);
});
test('closed Bridge dialog discards delayed job responses',async()=>{
  const h=harness({pending:true});
  const pending=h.request(h.panel,h.button);
  h.panel.isConnected=false;
  h.finish();
  await pending;
  assert.equal(h.children.filter(e=>e.className==='bridge-job-controls').length,0);
});
test('revoked admin cannot submit Bridge jobs',async()=>{
  const h=harness();
  h.context.profile.role='user';
  await h.request(h.panel,h.button);
  assert.equal(h.calls.length,0);
});

test('Bridge active job survives panel re-entry without enqueueing again',async()=>{
  const h=harness();
  await h.request(h.panel,h.button);
  const saved=h.bridgePendingJobs.get('admin:'+DEVICE);
  assert.equal(saved.jobId,JOB);
  const reopened={isConnected:true};
  const secondButton={dataset:{bridgeRequest:DEVICE},parentElement:h.row,disabled:false};
  await h.request(reopened,secondButton,saved);
  assert.equal(h.calls.filter(c=>c[0]==='list').length,1);
  assert.equal(secondButton.disabled,true);
  const controls=h.children.find(e=>e.className==='bridge-job-controls');
  await controls.children[1].onclick();
  assert.equal(h.bridgePendingJobs.has('admin:'+DEVICE),false);
});
test('Bridge delayed response from closed panel retains recoverable job metadata',async()=>{
  const h=harness({pending:true});
  const work=h.request(h.panel,h.button);
  h.panel.isConnected=false;
  h.finish();
  await work;
  assert.equal(h.bridgePendingJobs.get('admin:'+DEVICE)?.jobId,JOB);
  assert.equal(h.children.filter(e=>e.className==='bridge-job-controls').length,0);
});
