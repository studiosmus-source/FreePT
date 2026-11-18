/**
 * Fail-closed native-only OTA configuration. Web Vite bundles cannot change
 * the native endpoint, activation mode, app id or signing identity.
 */
export function configureNativeUpdater(config,{enable='',url=''}={}){
  if(config?.appId!=='it.freept.app')throw Error('ota_native_app_id_mismatch');
  const copy=JSON.parse(JSON.stringify(config));
  copy.plugins??={};
  const original=copy.plugins.CapacitorUpdater||{};
  if(!enable&&!url){
    copy.plugins.CapacitorUpdater={...original,autoUpdate:'off',statsUrl:'',allowModifyUrl:false};
    delete copy.plugins.CapacitorUpdater.updateUrl;
    return copy;
  }
  if(enable!=='I_ACCEPT_FREEPT_OTA')throw Error('ota_explicit_opt_in_required');
  let parsed;
  try{parsed=new URL(url);}catch{throw Error('ota_update_endpoint_invalid');}
  if(parsed.protocol!=='https:'||!parsed.hostname||
     parsed.hostname==='localhost'||parsed.hostname.endsWith('.supabase.co')||
     parsed.port||parsed.username||parsed.password||parsed.search||parsed.hash||
     parsed.pathname!=='/updates')
    throw Error('ota_update_endpoint_invalid');
  copy.plugins.CapacitorUpdater={
    ...original,autoUpdate:'atBackground',updateUrl:parsed.href,
    statsUrl:'',allowModifyUrl:false,resetWhenUpdate:true,appReadyTimeout:15000
  };
  return copy;
}
