/**
 * Trusted owner-only enrollment for the ISOLATED FreePT Bridge test backend.
 * Every owner request authenticates against Supabase Auth and profiles; a
 * browser-chosen owner ID or role is never trusted. No listener or storage key.
 */
import {randomUUID,randomBytes,createHash} from 'node:crypto';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED=/^[^\u0000-\u001f\u007f]{1,100}$/u;
const bearer=headers=>{
  const match=/^Bearer ([^\s]{20,8192})$/.exec(headers?.authorization||'');
  return match?.[1]||null;
};
const fail=(status,error)=>({status,body:{error}});
export function createBridgeOwnerEnrollmentHandler({
  authClient,profilesClient,rpcClient,newDeviceId=randomUUID,
  randomBytesFn=randomBytes,
  onAuthDiagnostic=reason=>console.warn('bridge_owner_auth_rejected',reason)
}={}){
  if(typeof authClient?.auth?.getUser!=='function'||
     typeof profilesClient?.from!=='function'||
     typeof rpcClient?.rpc!=='function'||
     typeof newDeviceId!=='function'||typeof randomBytesFn!=='function')
    throw Error('bridge_owner_enrollment_dependencies_invalid');
  async function ownerId(token){
    const rejected=reason=>{
      // Diagnostics are best-effort: a broken logger must not change auth behavior.
      try { onAuthDiagnostic(reason); } catch { /* fail closed */ }
      return null;
    };
    try{
      const response=await authClient.auth.getUser(token);
      const user=response?.data?.user;
      if(response?.error||!UUID.test(user?.id))
        return rejected('token_invalid');
      const answer=await profilesClient.from('profiles')
        .select('id,role,status').eq('id',user.id).maybeSingle();
      if(answer?.error)return rejected('profile_query_failed');
      if(answer?.data?.id!==user.id)return rejected('profile_missing');
      if(answer.data.status!=='approved')return rejected('profile_not_approved');
      if(!['user','admin'].includes(answer.data.role))return rejected('profile_role_invalid');
      return user.id;
    }catch{return rejected('auth_or_profile_exception');}
  }
  return async function handleBridgeOwnerEnrollment(req){
    if(req?.method!=='POST')return fail(405,'method_not_allowed');
    const path=req?.path;
    if(path!=='/bridge/owner/enroll'&&path!=='/bridge/owner/delete')
      return fail(404,'not_found');
    const token=bearer(req.headers);
    if(!token)return fail(401,'authentication_required');
    const body=req.body;
    if(!body||typeof body!=='object'||Array.isArray(body))
      return fail(400,'invalid_request');
    if(path.endsWith('/enroll')?
       (Object.keys(body).length!==1||typeof body.label!=='string'||
        !ALLOWED.test(body.label)||!body.label.trim()):
       (Object.keys(body).length!==1||!UUID.test(body.deviceId)))
      return fail(400,'invalid_request');
    const owner=await ownerId(token);
    if(!owner)return fail(403,'bridge_owner_denied');
    try{
      if(path.endsWith('/delete')){
        const deleted=await rpcClient.rpc('bridge_server_delete_device',{
          p_device_id:body.deviceId,p_owner_id:owner
        });
        if(deleted?.error||deleted?.data!==true)
          return fail(403,'bridge_owner_denied');
        return {status:200,body:{deleted:true}};
      }
      const deviceId=newDeviceId();
      const secret=randomBytesFn(32).toString('hex');
      const salt=randomBytesFn(16).toString('hex');
      if(!UUID.test(deviceId)||!/^[0-9a-f]{64}$/.test(secret)||
         !/^[0-9a-f]{32}$/.test(salt))
        throw Error('bridge_enrollment_entropy_invalid');
      const verifier=createHash('sha256')
        .update('freept-bridge-device-v1\0').update(deviceId).update('\0')
        .update(salt).update(secret).digest('hex');
      const created=await rpcClient.rpc('bridge_server_enroll_device',{
        p_device_id:deviceId,p_owner_id:owner,p_label:body.label.trim(),
        p_salt_hex:salt,p_verifier_hex:verifier
      });
      if(created?.error||created?.data!==deviceId)
        return fail(409,'bridge_enrollment_unavailable');
      // Transmit secret ONCE, only to authenticated owner via trusted HTTPS.
      // UI must save it to Android Keystore, never to web localStorage.
      return {status:201,body:{deviceId,deviceSecret:secret}};
    }catch{
      return fail(503,'bridge_enrollment_unavailable');
    }
  };
}
