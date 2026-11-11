/** Dedicated production Bridge server. No staging fallbacks or side effects on import. */
import {createClient} from '@supabase/supabase-js';
import {createBridgeOwnerEnrollmentHandler} from './ownerEnrollment.mjs';
import {createTrustedBridgeBackend} from './trustedBackend.mjs';
import {createBridgeHttpsGateway,validateBridgeGatewayConfig} from './httpsGateway.mjs';

const PRODUCTION_HOST='cpopqsvzzxfjgnlawlvc.supabase.co';
const PUBLISHABLE=/^sb_publishable_[A-Za-z0-9_-]{16,}$/;
const SECRET=/^(?:sb_secret_[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{50,})$/;
export function validateBridgeProductionConfig(env={}){
  if(env.FREEPT_BRIDGE_PRODUCTION!=='I_ACCEPT_PRODUCTION_BRIDGE')
    throw Error('bridge_production_opt_in_required');
  let url;
  try{url=new URL(env.FREEPT_BRIDGE_PRODUCTION_SUPABASE_URL)}
  catch{throw Error('bridge_production_url_invalid')}
  if(url.origin!==('https://'+PRODUCTION_HOST)||url.pathname!=='/'||
     url.username||url.password||url.search||url.hash)
    throw Error('bridge_production_url_invalid');
  const publishable=env.FREEPT_BRIDGE_PRODUCTION_SUPABASE_PUBLISHABLE_KEY;
  const secret=env.FREEPT_BRIDGE_PRODUCTION_SUPABASE_SERVICE_ROLE_KEY;
  if(typeof publishable!=='string'||!PUBLISHABLE.test(publishable)||
     typeof secret!=='string'||!SECRET.test(secret)||publishable===secret)
    throw Error('bridge_production_credentials_invalid');
  const validated=validateBridgeGatewayConfig(env,'production');
  // Android Capacitor uses the fixed WebView origin http://localhost by
  // default. Permit exactly that first-party local origin in production,
  // even if a deployment retained the old https://localhost origin.
  // Bearer authentication and per-device grants remain mandatory.
  const origins=Object.freeze([...new Set([...validated.origins,'http://localhost'])]);
  const http=Object.freeze({...validated,origins});
  return Object.freeze({url:url.origin,publishable,secret,http});
}
export function createBridgeProductionService({env,createClientFn=createClient}={}){
  const config=validateBridgeProductionConfig(env);
  if(typeof createClientFn!=='function')throw Error('bridge_production_clients_invalid');
  const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
  const authClient=createClientFn(config.url,config.publishable,options);
  const serviceClient=createClientFn(config.url,config.secret,options);
  const {admin,tx}=createTrustedBridgeBackend({
    authClient,profilesClient:serviceClient,verifiersClient:serviceClient,
    rpcClient:serviceClient,readJobsEnabled:true
  });
  const owner=createBridgeOwnerEnrollmentHandler({
    authClient,profilesClient:serviceClient,rpcClient:serviceClient
  });
  const gateway=createBridgeHttpsGateway({admin,tx,owner,config:config.http});
  return Object.freeze({
    start:()=>gateway.start({host:'0.0.0.0',port:config.http.port}),
    stop:()=>gateway.stop()
  });
}
