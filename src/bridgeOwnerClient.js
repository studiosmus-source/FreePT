/**
 * Explicit owner-initiated pairing against dedicated HTTPS Bridge staging.
 * The one-time secret is immediately handed to native Android Keystore;
 * it is never written to localStorage, logs, chat or Supabase client tables.
 * No automatic background connection or broad folder permission.
 */
import {normalizeBridgeApiUrl} from './bridgeAdminClient.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX=/^[0-9a-f]{64}$/;
export function createBridgeOwnerClient({
  baseUrl,auth,credentials,fetchImpl=fetch
}={}){
  const url=normalizeBridgeApiUrl(baseUrl);
  if(!url||typeof auth?.getSession!=='function'||
     typeof credentials?.provision!=='function'||
     typeof credentials?.status!=='function'||
     typeof credentials?.clear!=='function'||
     typeof fetchImpl!=='function')return null;
  async function post(action,payload){
    const {data,error}=await auth.getSession();
    const accessToken=data?.session?.access_token;
    if(error||typeof accessToken!=='string'||accessToken.length<20)
      throw Error('bridge_owner_login_required');
    let response;
    try{
      response=await fetchImpl(url+'/bridge/owner/'+action,{
        method:'POST',headers:{
          'content-type':'application/json',authorization:'Bearer '+accessToken
        },body:JSON.stringify(payload),cache:'no-store',redirect:'error'
      });
    }catch{throw Error('bridge_owner_backend_unavailable');}
    if(!response?.ok)
      throw Error(response?.status===401||response?.status===403
        ?'bridge_owner_denied':'bridge_owner_request_failed');
    try{return await response.json();}
    catch{throw Error('bridge_owner_invalid_response');}
  }
  async function deleteDevice(deviceId){
    if(!UUID.test(deviceId))throw Error('bridge_owner_invalid_device');
    const answer=await post('delete',{deviceId});
    if(answer?.deleted!==true)throw Error('bridge_owner_invalid_response');
    return true;
  }
  return Object.freeze({
    async status(){return credentials.status();},
    async enroll(label){
      if(typeof label!=='string'||!label.trim()||label.length>100||
         /[\u0000-\u001f\u007f]/.test(label))
        throw Error('bridge_owner_invalid_label');
      const current=await credentials.status();
      if(current?.provisioned){
        // Reinstallation/return to enrollment must never overwrite an
        // existing Keystore secret or create duplicate server devices.
        if(!UUID.test(current.deviceId))
          throw Error('bridge_owner_invalid_local_registration');
        return {deviceId:current.deviceId,provisioned:true,alreadyProvisioned:true};
      }
      const result=await post('enroll',{label:label.trim()});
      if(!result||Object.keys(result).sort().join(',')!=='deviceId,deviceSecret'||
         !UUID.test(result.deviceId)||!HEX.test(result.deviceSecret))
        throw Error('bridge_owner_invalid_response');
      try{
        const saved=await credentials.provision({
          deviceId:result.deviceId,deviceSecret:result.deviceSecret
        });
        if(saved?.saved!==true)throw Error('bridge_owner_keystore_failed');
      }catch{
        // Failed local save: best-effort revoke credential server-side.
        // Never return secret for caller to store insecurely.
        try{await deleteDevice(result.deviceId);}catch{}
        throw Error('bridge_owner_keystore_failed');
      }
      return {deviceId:result.deviceId,provisioned:true};
    },
    async remove(){
      const current=await credentials.status();
      if(!current?.provisioned||!UUID.test(current.deviceId))
        throw Error('bridge_owner_device_not_provisioned');
      // Revoke server access before discarding the local secret.
      await deleteDevice(current.deviceId);
      const result=await credentials.clear();
      if(result?.cleared!==true)throw Error('bridge_owner_local_clear_failed');
      return true;
    }
  });
}
