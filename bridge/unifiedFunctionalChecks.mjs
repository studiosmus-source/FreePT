/** Invoked only by the explicitly gated staging runner. All content synthetic. */
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {createBridgeAdminClient} from '../src/bridgeAdminClient.js';
const BASE='https://freept-bridge-staging.onrender.com';
const hash=b=>createHash('sha256').update(b).digest('hex');
export async function runUnifiedFunctionalChecks({config,admin,user,adminId,userId,check,report,fetchFn=fetch}){
 if(config.url!=='https://aqjuixbuxftnjfzxmzuj.supabase.co')throw Error('isolated_test_required');
 const anonymous=createClient(config.url,config.publishable,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 let ownerDevice,anonId,attachment;
 const token=(await user.auth.getSession()).data.session.access_token;
 async function post(path,body,bearer){
  const r=await fetchFn(BASE+path,{method:'POST',headers:{'content-type':'application/json',...(bearer?{authorization:'Bearer '+bearer}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(55000)});
  const data=await r.json();check('HTTPS '+path+' '+r.status,r.ok);return data;
 }
 try{
  const login=await anonymous.auth.signInAnonymously();
  check('Real app anonymous sign-in enabled',!login.error&&login.data.user?.is_anonymous===true);
  anonId=login.data.user.id;report.fixtures.registrationUserId=anonId;
  const registration=await anonymous.from('profiles').insert({id:anonId,full_name:'FreePT synthetic registration 02',phone:'+999'+String(Date.now()).slice(-11)}).select('id,status,role').single();
  check('Real app name and phone registration creates pending user',!registration.error&&registration.data?.status==='pending'&&registration.data?.role==='user');
  const denied=await anonymous.from('messages').insert({user_id:anonId,sender_id:anonId,body:'must be denied'});
  check('Pending registration cannot send chat',!!denied.error);
  const approved=await admin.from('profiles').update({status:'approved'}).eq('id',anonId).select('approved_by').single();
  check('Approving administrator recorded server-side',!approved.error&&approved.data?.approved_by===adminId);
  for(const [sender,id,text] of [[anonymous,anonId,'synthetic user message'],[admin,adminId,'synthetic admin reply']]){
   const sent=await sender.from('messages').insert({user_id:anonId,sender_id:id,body:text});
   check('Chat send '+(id===anonId?'user':'admin'),!sent.error);
  }
  const read=await anonymous.from('messages').select('body').eq('user_id',anonId);
  check('User reads both chat messages',!read.error&&read.data?.length===2);
  attachment=anonId+'/'+randomUUID()+'/synthetic.bin';const content=randomBytes(1024);
  const upload=await anonymous.storage.from('attachments').upload(attachment,content);
  check('User uploads synthetic attachment',!upload.error);
  const download=await admin.storage.from('attachments').download(attachment);
  check('Admin downloads exact attachment bytes',!download.error&&hash(Buffer.from(await download.data.arrayBuffer()))===hash(content));
  const remove=await admin.storage.from('attachments').remove([attachment]);
  check('Admin removes only synthetic attachment',!remove.error);attachment=null;
  const cleared=await admin.rpc('freept_admin_delete_conversation',{p_user_id:anonId,p_delete_user:false});
  const empty=await anonymous.from('messages').select('id').eq('user_id',anonId);
  check('Admin clears synthetic chat and preserves account',!cleared.error&&!empty.error&&empty.data?.length===0);

  const enrollment=await post('/bridge/owner/enroll',{label:'FreePT unified synthetic 02'},token);
  ownerDevice=enrollment.deviceId;report.fixtures.ownerDeviceId=ownerDevice;
  const activated=await user.rpc('bridge_owner_activate_family',{p_device_id:ownerDevice});
  check('Owner grants only approving admin despite multiple test admins',!activated.error&&activated.data===adminId);
  const connected=await post('/bridge/tx/connect',{deviceId:ownerDevice,deviceSecret:enrollment.deviceSecret});
  const txBody={deviceId:ownerDevice,sessionToken:connected.token};
  const receiver=createBridgeAdminClient({baseUrl:BASE,auth:admin.auth,fetchImpl:fetchFn});
  const handle=randomUUID(),fixture=randomBytes(300000);
  const browse=await receiver.requestBrowse(ownerDevice);
  const job=(await post('/bridge/tx/poll',txBody)).job;
  check('Real TX receives exact owner browse job',job?.jobId===browse.jobId&&job.operation==='browse');
  await post('/bridge/tx/browse',{...txBody,jobId:job.jobId,entries:[{handle,name:'.hidden-synthetic.bin',directory:false,size:fixture.length,mime:'application/octet-stream'}],nextOffset:-1});
  const page=await receiver.getBrowsePage(job.jobId);
  check('Hidden file metadata reaches authorized administrator',page.entries[0]?.name==='.hidden-synthetic.bin');
  const pieces=[];
  for(let offset=0;offset<fixture.length;offset+=262144){
   const length=Math.min(262144,fixture.length-offset);
   const request=await receiver.requestRead(ownerDevice,{handle,offset,length});
   const command=(await post('/bridge/tx/poll',txBody)).job;
   check('Real TX receives exact chunk offset '+offset,command?.jobId===request.jobId&&command.offset===offset&&command.length===length);
   const bytes=fixture.subarray(offset,offset+length);
   await post('/bridge/tx/chunk',{...txBody,jobId:command.jobId,chunk:{base64:bytes.toString('base64'),bytesRead:length,eof:offset+length===fixture.length}});
   pieces.push(Buffer.from((await receiver.getReadChunk(command.jobId)).base64,'base64'));
  }
  const received=Buffer.concat(pieces);
  check('Normal Bridge transfers 300000 bytes with matching SHA256',received.length===300000&&hash(received)===hash(fixture));
  report.normalBridge={bytes:received.length,sha256:hash(received),hiddenNamePreserved:true,transport:'Node synthetic TX over real HTTPS; not Android'};
  const revoked=await user.rpc('bridge_owner_set_enabled',{p_device_id:ownerDevice,p_enabled:false});
  check('Owner revocation succeeds',!revoked.error);
  let rejected=false;try{await receiver.requestBrowse(ownerDevice);}catch{rejected=true;}
  check('Revoked normal device rejects new browse',rejected);
 }finally{
  if(ownerDevice){try{await post('/bridge/owner/delete',{deviceId:ownerDevice},token);}catch{report.normalDeviceCleanup='FAILED';}}
  if(attachment){try{await admin.storage.from('attachments').remove([attachment]);}catch{report.attachmentCleanup='FAILED';}}
  if(anonId){
   const deleted=await admin.rpc('freept_admin_delete_conversation',{p_user_id:anonId,p_delete_user:true});
   check('Admin deletes only newly created synthetic registration',!deleted.error);
  }
  await anonymous.auth.signOut({scope:'local'});
 }
}
