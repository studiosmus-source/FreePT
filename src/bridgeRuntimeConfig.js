/**
 * Build-time Bridge boundary: isolated testing and production are mutually exclusive.
 * Native Bridge activation additionally requires the corresponding installed plugins.
 */
import {normalizeBridgeApiUrl} from './bridgeAdminClient.js';

export function resolveBridgeRuntimeConfig({
  isolated=false,production=false,testApiUrl,productionApiUrl
}={}){
  if(isolated&&production)throw Error('bridge_build_modes_conflict');
  if(!isolated&&!production)return Object.freeze({enabled:false,baseUrl:null});
  const selected=isolated?testApiUrl:productionApiUrl;
  const forbidden=isolated?productionApiUrl:testApiUrl;
  if(forbidden)throw Error('bridge_cross_environment_endpoint');
  const baseUrl=normalizeBridgeApiUrl(selected);
  if(!baseUrl)throw Error('bridge_backend_https_required');
  return Object.freeze({enabled:true,baseUrl});
}
