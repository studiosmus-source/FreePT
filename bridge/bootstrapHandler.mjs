import {randomBytes} from 'node:crypto';
import {createSupabaseBridgeAdminAuthenticator} from './supabaseAdminAuth.mjs';
import {verifyBootstrapEnvelope,bootstrapHash,bootstrapBytes,BOOTSTRAP_SIZE} from './bootstrapProtocol.mjs';
const fail=(status,error)=>({status,body:{error}});
const token=headers=>/^Bearer ([^\s]{20,8192})$/.exec(headers?.authorization||'')?.[1];
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===keys.sort().join(',');
/** Explicit staging opt-in. No routes are installed by the production composition. */
export function createBootstrapHandler({authClient,db,enabled=false,now=Date.now}={}){
 const adminAuth=createSupabaseBridgeAdminAuthenticator({authClient,profilesClient:db});
 const rpc=async(action,id,key,nonce,data,actor=null)=>{
  const r=await db.rpc('bridge_bootstrap_step',{p_action:action,p_id:id,p_key:key,p_nonce:nonce,p_data:data,p_actor:actor});
  if(r?.error||!r?.data)throw Error('bootstrap_denied');return r.data;
 };
 return async req=>{
  if(!enabled)return fail(404,'bootstrap_disabled');
  if(req?.method!=='POST')return fail(405,'method_not_allowed');
  const action=req.path?.replace('/bridge/bootstrap/','');
  if(!['start','poll','chunk','status','claim','cancel','approve','revoke'].includes(action))return fail(404,'not_found');
  try{
   if(['approve','revoke'].includes(action)){
    const admin=await adminAuth({accessToken:token(req.headers)});
    if(!admin)return fail(403,'bootstrap_admin_required');
    const b=req.body;
    if(action==='approve'&&!exact(b,['pairCode'])||action==='revoke'&&!exact(b,['deviceId']))return fail(400,'invalid_request');
    if(action==='approve'&&!/^[0-9A-Fa-f]{12}$/.test(b.pairCode)||action==='revoke'&&!/^[0-9a-f-]{36}$/i.test(b.deviceId))return fail(400,'invalid_request');
    const data=action==='approve'?{pairHash:bootstrapHash(b.pairCode.toLowerCase())}:{};
    return {status:200,body:await rpc(action,action==='revoke'?b.deviceId:null,null,null,data,admin.id)};
   }
   const e=req.body;
   if(typeof e?.payload!=='string'||e.payload.length>355000)return fail(400,'invalid_request');
   let b;try{b=JSON.parse(e.payload);}catch{return fail(400,'invalid_request')}
   if(!b||typeof b!=='object'||Array.isArray(b))return fail(400,'invalid_request');
   let key;
   if(action==='start')key=b.publicKey;
   else{
    if(typeof e.deviceId!=='string'||!/^[0-9a-f-]{36}$/i.test(e.deviceId))return fail(400,'invalid_request');
    const r=await db.from('bridge_bootstrap_devices').select('public_key').eq('id',e.deviceId).maybeSingle();
    if(r.error)return fail(503,'bootstrap_unavailable');key=r.data?.public_key;
   }
   if(!verifyBootstrapEnvelope(action,e,key,now()))return fail(403,'bootstrap_device_proof_required');
   let data={},actor=null;
   if(action==='start'){
    if(!exact(b,['publicKey','pairCode','consent'])||b.consent!==true||!/^[0-9a-f]{12}$/.test(b.pairCode))return fail(400,'bootstrap_consent_required');
    data={pairHash:bootstrapHash(b.pairCode),challenge:randomBytes(32).toString('hex')};
   }else if(action==='chunk'){
    if(!exact(b,['offset','base64'])||typeof b.base64!=='string'||b.base64.length>349528||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(b.base64))return fail(400,'invalid_chunk');
    // Authoritative state is checked again atomically by SQL after validation.
    const r=await db.from('bridge_bootstrap_devices').select('challenge').eq('id',e.deviceId).maybeSingle();
    if(r.error||!r.data)return fail(403,'bootstrap_denied');
    const bytes=Buffer.from(b.base64,'base64');
    if(!bytes.equals(bootstrapBytes(r.data.challenge,b.offset,bytes.length)))return fail(400,'bootstrap_integrity_failed');
    data={offset:b.offset,length:bytes.length,sha256:bootstrapHash(bootstrapBytes(r.data.challenge,0,Math.min(262144,BOOTSTRAP_SIZE)))};
    // Whole fixture hash, independent from upload boundaries.
    const all=Buffer.concat([bootstrapBytes(r.data.challenge,0,262144),bootstrapBytes(r.data.challenge,262144,BOOTSTRAP_SIZE-262144)]);
    data.sha256=bootstrapHash(all);
   }else if(action==='claim'){
    if(!exact(b,['deviceSecret'])||!/^[0-9a-f]{64}$/.test(b.deviceSecret))return fail(400,'invalid_claim');
    const t=token(req.headers);if(!t)return fail(401,'bootstrap_personal_login_required');
    const u=await authClient.auth.getUser(t);actor=u.data?.user?.id;
    if(u.error||!actor)return fail(403,'bootstrap_personal_login_required');
    const salt=randomBytes(16).toString('hex');
    data={salt,verifier:bootstrapHash('freept-bridge-device-v1\0'+e.deviceId+'\0'+salt+b.deviceSecret)};
   }else if(!exact(b,[]))return fail(400,'invalid_request');
   return {status:200,body:await rpc(action,e.deviceId,key,e.nonce,data,actor)};
  }catch(error){return fail(error?.message==='bootstrap_denied'?403:503,error?.message==='bootstrap_denied'?'bootstrap_denied':'bootstrap_unavailable');}
 };
}
