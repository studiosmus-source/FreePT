/**
 * Explicitly isolated, LOOPBACK-ONLY staging harness for the Bridge.
 * NEVER use as a public Internet listener or production server.
 *
 * Requires a separate test Supabase project with the Bridge SQL installed.
 * Starts only when all configuration is present and differs from production.
 * Credentials are read solely in this Node process, never bundled by Vite.
 */
import {createClient} from '@supabase/supabase-js';
import {createTrustedBridgeBackend} from './trustedBackend.mjs';
import {createBridgeLoopbackTestServer} from './loopbackHttp.mjs';

const PRODUCTION_HOST='cpopqsvzzxfjgnlawlvc.supabase.co';
// Only a validated configuration is allowed to reach privileged clients.
const validatedConfigs=new WeakSet();
const PUBLISHABLE=/^sb_publishable_[A-Za-z0-9_-]{16,}$/;
const SERVICE_ROLE=/^(?:sb_secret_[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{50,})$/;

export function validateBridgeStagingConfig(env) {
  if (!env || env.FREEPT_BRIDGE_STAGING!=='I_UNDERSTAND_LOCAL_TEST_ONLY')
    throw Error('bridge_staging_explicit_opt_in_required');
  const raw=env.FREEPT_BRIDGE_TEST_SUPABASE_URL;
  let url;
  try {url=new URL(raw);} catch {throw Error('bridge_staging_url_invalid');}
  if(url.protocol!=='https:'||!url.hostname.endsWith('.supabase.co')||
     url.hostname===PRODUCTION_HOST||url.username||url.password||
     url.port||url.pathname!=='/'||url.search||url.hash)
    throw Error('bridge_staging_url_invalid');
  const publishable=env.FREEPT_BRIDGE_TEST_SUPABASE_PUBLISHABLE_KEY;
  const serviceKey=env.FREEPT_BRIDGE_TEST_SUPABASE_SERVICE_ROLE_KEY;
  if(typeof publishable!=='string'||!PUBLISHABLE.test(publishable)||
     typeof serviceKey!=='string'||!SERVICE_ROLE.test(serviceKey)||
     publishable===serviceKey)
    throw Error('bridge_staging_credentials_invalid');
  const config=Object.freeze({url:url.origin,publishable,serviceKey});
  validatedConfigs.add(config);
  return config;
}

export function createBridgeStagingServer({config,createClientFn=createClient}){
  if(!config||!validatedConfigs.has(config)||
     typeof createClientFn!=='function')
    throw Error('bridge_staging_dependencies_invalid');
  // The public key is used only to verify user access tokens. Service role is
  // confined to the server-controlled SQL RPCs and narrow table lookups.
  const authClient=createClientFn(config.url,config.publishable,{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
  });
  const dbClient=createClientFn(config.url,config.serviceKey,{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
  });
  const handlers=createTrustedBridgeBackend({
    authClient,profilesClient:dbClient,verifiersClient:dbClient,rpcClient:dbClient
  });
  return createBridgeLoopbackTestServer({
    handler:handlers.admin,txHandler:handlers.tx
  });
}

export async function startBridgeStagingServer(env=process.env){
  const config=validateBridgeStagingConfig(env);
  const server=createBridgeStagingServer({config});
  const url=await server.start();
  return {server,url};
}
