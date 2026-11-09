/**
 * Explicit owner controls for an already enrolled, isolated Bridge device.
 * Supabase RPCs independently verify auth.uid(), owner_id, grant recipient,
 * row locks, and revocation. The UI must never treat a successful RPC as
 * proof of a running remote connection.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const errorOf=(reply,code)=>{if(reply?.error)throw Error(code);};
// Report only known SQL failure categories, never raw database errors or identifiers.
export const familyActivationErrorCode=(error)=>{
  const allowed=new Set(['bridge_owner_not_approved','bridge_invalid_device',
    'bridge_owner_required','bridge_unique_admin_required','bridge_admin_not_unique']);
  const message=typeof error?.message==='string'?error.message:'';
  return allowed.has(message)?message:'bridge_owner_activation_denied';
};
export function createBridgeOwnerControls({db,auth}={}){
  if(typeof db?.rpc!=='function'||typeof db?.from!=='function'||
     typeof auth?.getSession!=='function')
    throw Error('bridge_owner_controls_dependencies_invalid');
  const authorized=async()=>{
    const {data,error}=await auth.getSession();
    if(error||typeof data?.session?.access_token!=='string'||
       data.session.access_token.length<20)
      throw Error('bridge_owner_login_required');
    return data.session.user?.id||null;
  };
  async function device(deviceId){
    if(!UUID.test(deviceId))throw Error('bridge_owner_invalid_device');
    const uid=await authorized();
    if(!UUID.test(uid))throw Error('bridge_owner_login_required');
    const response=await db.from('bridge_devices')
      .select('id,owner_id,bridge_enabled').eq('id',deviceId).eq('owner_id',uid).maybeSingle();
    errorOf(response,'bridge_owner_device_unavailable');
    if(response.data?.id!==deviceId||response.data?.owner_id!==uid)
      throw Error('bridge_owner_device_unavailable');
    return {enabled:response.data.bridge_enabled===true};
  }
  const rpc=async(name,args)=>{
    await authorized();
    const result=await db.rpc(name,args);
    errorOf(result,'bridge_owner_control_denied');
    return true;
  };
  return Object.freeze({
    device,
    async activateFamily(deviceId){
      if(!UUID.test(deviceId))throw Error('bridge_owner_invalid_control');
      await device(deviceId);
      // The server derives the only eligible approved admin. No UUID is
      // entered or chosen in the elderly family member's interface.
      const {data,error}=await db.rpc('bridge_owner_activate_family',{
        p_device_id:deviceId
      });
      if(error)throw Error(familyActivationErrorCode(error));
      if(!UUID.test(data))throw Error('bridge_owner_activation_denied');
      return true;
    },
    async setEnabled(deviceId,enabled){
      if(!UUID.test(deviceId)||typeof enabled!=='boolean')
        throw Error('bridge_owner_invalid_control');
      await device(deviceId);
      return rpc('bridge_owner_set_enabled',{p_device_id:deviceId,p_enabled:enabled});
    },
    async grant(deviceId,receiverId){
      if(!UUID.test(deviceId)||!UUID.test(receiverId))
        throw Error('bridge_owner_invalid_control');
      await device(deviceId);
      return rpc('bridge_owner_grant',{p_device_id:deviceId,p_receiver_id:receiverId});
    },
    async revoke(deviceId,receiverId){
      if(!UUID.test(deviceId)||!UUID.test(receiverId))
        throw Error('bridge_owner_invalid_control');
      await device(deviceId);
      return rpc('bridge_owner_revoke',{p_device_id:deviceId,p_receiver_id:receiverId});
    },
    async recipients(deviceId){
      await device(deviceId);
      const response=await db.from('bridge_grants')
        .select('receiver_id,revoked_at').eq('device_id',deviceId).limit(25);
      errorOf(response,'bridge_owner_grants_unavailable');
      return (response.data||[]).filter(x=>UUID.test(x.receiver_id))
        .map(x=>({receiverId:x.receiver_id,active:x.revoked_at===null}));
    }
  });
}
