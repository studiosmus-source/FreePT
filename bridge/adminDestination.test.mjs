import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createBridgeAndroidFolderDestination,createBridgeAndroidSingleFileWriter} from '../src/bridgeAndroidDestination.js';
const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const OWNER='11111111-1111-4111-8111-111111111111';
const FILE='33333333-3333-4333-8333-333333333333';
const meta={name:'foto.jpg',size:3,mime:'image/jpeg'};

test('chat and folder adapters send the same stable identity without altering file paths',async()=>{
 const calls=[];
 const plugin={beginSingleFile:async x=>{calls.push(x);return {fileId:FILE}},
  writeChunk:async()=>{},commitFile:async()=>{},commitSingleFile:async()=>{},discardSingleFile:async()=>{},
  beginFolder:async x=>{calls.push(x);return {started:true}},makeDirectory:async()=>{},openFile:async()=>{},
  discardFile:async()=>{},commitFolder:async()=>{},discardFolder:async()=>{}};
 const owner={ownerId:OWNER,ownerName:'Cristina Rossi'};
 await createBridgeAndroidSingleFileWriter({plugin,...meta,...owner});
 await createBridgeAndroidFolderDestination({plugin,name:'DownloadTelefono',...owner}).begin();
 for(const call of calls){assert.equal(call.ownerId,OWNER);assert.equal(call.ownerName,owner.ownerName);}
 assert.equal(calls[0].name,'foto.jpg');assert.equal(calls[1].name,'DownloadTelefono');
});
test('invalid or incomplete admin identities fail before native storage starts',async()=>{
 let calls=0;
 const plugin={beginSingleFile:async()=>{calls++;return {fileId:FILE}},writeChunk:async()=>{},
  commitFile:async()=>{},commitSingleFile:async()=>{},discardSingleFile:async()=>{}};
 for(const owner of [{ownerId:'../x',ownerName:'X'},{ownerId:OWNER,ownerName:''},{ownerId:null,ownerName:'X'}])
  await assert.rejects(createBridgeAndroidSingleFileWriter({plugin,...meta,...owner}),/invalid_owner/);
 assert.equal(calls,0);
});
function fixture(){
 const calls=[];
 const state={profile:{role:'admin',status:'approved'},adminUnlocked:true,
  me:{id:'admin-one'},selected:OWNER,people:[{id:OWNER,full_name:'Cristina',status:'approved'}],
  bridgeDestination:{getDestination:async()=>({selected:true})},
  createBridgeAndroidSingleFileWriter:async options=>{calls.push(['begin',options]);return {
    write:async()=>calls.push(['write']),commit:async()=>calls.push(['commit']),discard:async()=>calls.push(['discard'])};}};
 const code=main.slice(main.indexOf('function adminAttachmentWriter('),main.indexOf('// Small files keep'));
 const context=vm.createContext(state);vm.runInContext(code,context);
 return {state,calls,make:context.adminAttachmentWriter};
}
test('admin writer captures person before fetch and rejects switching chats',async()=>{
 const f=fixture(),make=f.make(OWNER);
 f.state.selected='22222222-2222-4222-8222-222222222222';
 await assert.rejects(make(meta),/non autorizzato/);assert.equal(f.calls.length,0);
});
test('role, account and approval revocation during transfer discard instead of committing',async()=>{
 for(const revoke of [f=>f.state.adminUnlocked=false,f=>f.state.profile.role='user',
   f=>f.state.me={id:'admin-two'},f=>f.state.people[0].status='blocked']){
  const f=fixture(),writer=await f.make(OWNER)(meta);revoke(f);
  await assert.rejects(writer.commit(),/non autorizzato/);
  assert.deepEqual(f.calls.map(x=>x[0]),['begin','discard']);
 }
});
test('admin writer rechecks authorization after Android picker returns',async()=>{
 const f=fixture();f.state.bridgeDestination.getDestination=async()=>({selected:false});
 f.state.bridgeDestination.chooseDestination=async()=>{f.state.selected='other';};
 await assert.rejects(f.make(OWNER)(meta),/non autorizzato/);assert.equal(f.calls.length,0);
});
test('administrator copies exact whitespace and Unicode; user cannot copy via admin function',async()=>{
 const calls=[],context=vm.createContext({profile:{role:'admin',status:'approved'},adminUnlocked:true,me:{id:'admin'},
  freeptAdminShare:{copyText:async value=>calls.push(value)},status:()=>{}});
 vm.runInContext(main.slice(main.indexOf('async function copyAdminChatText('),main.indexOf('function mountAdminChatShareActions(')),context);
 const text='  è\n\t👋  ';
 await context.copyAdminChatText(text);assert.equal(calls[0].text,text);
 context.profile.role='user';await context.copyAdminChatText('secret');assert.equal(calls.length,1);
});
