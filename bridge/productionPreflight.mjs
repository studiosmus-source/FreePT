/** Read-only production deployment preflight. Never prints credential values. */
import {validateBridgeProductionConfig} from './productionServer.mjs';

export function inspectProductionEnvironment(env={}){
  const required=[
    'FREEPT_BRIDGE_PRODUCTION','FREEPT_BRIDGE_PUBLIC',
    'FREEPT_BRIDGE_PRODUCTION_SUPABASE_URL',
    'FREEPT_BRIDGE_PRODUCTION_SUPABASE_PUBLISHABLE_KEY',
    'FREEPT_BRIDGE_PRODUCTION_SUPABASE_SERVICE_ROLE_KEY',
    'FREEPT_BRIDGE_ALLOWED_ORIGINS','PORT'
  ];
  const missing=required.filter(key=>!env[key]);
  if(missing.length)return Object.freeze({ready:false,missing,reason:'missing_configuration'});
  try{
    validateBridgeProductionConfig(env);
    return Object.freeze({ready:true,missing:[],reason:null});
  }catch(error){
    return Object.freeze({ready:false,missing:[],reason:error.message});
  }
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  const result=inspectProductionEnvironment(process.env);
  process.stdout.write(JSON.stringify(result)+'\n');
  if(!result.ready)process.exitCode=1;
}
