/**
 * Native Android push registration. The signed-in user is rechecked at
 * registration time, so a delayed FCM callback cannot register a token
 * against a different account after logout/account switching.
 */
export function createPushRegistration({plugin,db,getApprovedUser,onMessage,wakeToken=null}){
  let listenersReady=false;
  let token=null;
  let tokenOwner=null;
  let pending=null;
  const inFlightRegistrations=new Set();
  let closingOwner=null;
  const saveToken=async result=>{
            const operation=(async()=>{
            const current=getApprovedUser();
            if(!current?.id||current.id===closingOwner||!result?.value)return;
            const owner=current.id;
            const {error}=await db.from('push_devices').upsert({
              token:result.value,user_id:owner,platform:'android',
              updated_at:new Date().toISOString()
            },{onConflict:'token'});
            if(error)throw error;
            if(getApprovedUser()?.id===owner&&closingOwner!==owner){token=result.value;tokenOwner=owner;}
            else {
              // The login changed during the network request. Revoke the
              // just-written token before allowing logout to finish.
              const removed=await db.from('push_devices').delete()
                .eq('token',result.value).eq('user_id',owner);
              if(removed.error)throw removed.error;
            }
            })();
            inFlightRegistrations.add(operation);
            try{return await operation;}
            finally{inFlightRegistrations.delete(operation);}
  };
  async function init(){
    const user=getApprovedUser();
    if(!user?.id)return;
    if(closingOwner===user.id)return;
    closingOwner=null;
    if(!pending){
      pending=(async()=>{
        if(!listenersReady){
          await plugin.addListener('registration',saveToken);
          await plugin.addListener('registrationError',()=>{});
          await plugin.addListener('pushNotificationReceived',()=>onMessage());
          await plugin.addListener('pushNotificationActionPerformed',()=>onMessage());
          listenersReady=true;
        }
        // The consented Bridge needs its FCM identity even when the user has
        // opted out of chat notifications. No new Android permission is asked.
        if(wakeToken&&getApprovedUser()?.id===user.id){
          try{
            const result=await wakeToken.get();
            if(typeof result?.token==='string')
              await saveToken({value:result.token});
          }catch{/* A temporary FCM failure must never interrupt the chat. */}
        }
        // Android permissions may be revoked in Settings after initial grant.
        // Never rely on a previous render's permission state.
        let permission=await plugin.checkPermissions();
        if(permission.receive==='prompt')permission=await plugin.requestPermissions();
        if(permission.receive!=='granted')return;
        if(getApprovedUser()?.id===user.id&&closingOwner!==user.id)await plugin.register();
      })().finally(()=>{pending=null;});
    }
    return pending;
  }
  async function clear(ownerId){
    // Await a registration already in flight so logout cannot leave a token
    // behind due to an asynchronous database upsert.
    closingOwner=ownerId;
    await Promise.allSettled([...inFlightRegistrations]);
    if(token&&tokenOwner===ownerId){
      const {error}=await db.from('push_devices').delete()
        .eq('token',token).eq('user_id',ownerId);
      if(error)throw error;
      token=null;tokenOwner=null;
    }
  }
  // Called only after the authenticated session and local user are cleared.
  // Keep the logout guard active until then, but permit a fresh login of
  // the same account without requiring the Android process to restart.
  async function sessionEnded(){
    if(getApprovedUser()?.id)return;
    if(pending)await Promise.allSettled([pending]);
    await Promise.allSettled([...inFlightRegistrations]);
    if(!getApprovedUser()?.id)closingOwner=null;
  }
  return Object.freeze({init,clear,sessionEnded});
}
