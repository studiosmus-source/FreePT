/**
 * Separate staging HTTPS service composition. Only for a dedicated TLS
 * terminating managed reverse proxy (e.g. an isolated Render web service).
 * NO deployment side effects occur by importing or constructing this module.
 *
 * Both explicit gates are required: staging Supabase and public HTTPS proxy.
 * In particular, FreePT production Supabase is rejected by shared validator.
 */
import {createClient} from '@supabase/supabase-js';
import {createBridgeOwnerEnrollmentHandler} from './ownerEnrollment.mjs';
import {createTrustedBridgeBackend} from './trustedBackend.mjs';
import {validateBridgeStagingConfig} from './stagingServer.mjs';
import {createBridgeHttpsGateway,validateBridgeGatewayConfig} from './httpsGateway.mjs';

export function createBridgeStagingHttpsService({
  env,createClientFn=createClient
}={}){
  const dbConfig=validateBridgeStagingConfig(env);
  const httpConfig=validateBridgeGatewayConfig(env);
  if(typeof createClientFn!=='function')
    throw Error('bridge_public_clients_invalid');
  const clientOptions={
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
  };
  const authClient=createClientFn(dbConfig.url,dbConfig.publishable,clientOptions);
  const serviceClient=createClientFn(dbConfig.url,dbConfig.serviceKey,clientOptions);
  const {admin,tx}=createTrustedBridgeBackend({
    authClient,profilesClient:serviceClient,verifiersClient:serviceClient,
    rpcClient:serviceClient,
    readJobsEnabled:env?.FREEPT_BRIDGE_READ_ENABLED==='I_UNDERSTAND_TEST_ONLY'
  });
  const owner=createBridgeOwnerEnrollmentHandler({
    authClient,profilesClient:serviceClient,rpcClient:serviceClient
  });
  const gateway=createBridgeHttpsGateway({admin,tx,owner,config:httpConfig});
  return Object.freeze({
    async start(){
      // Bound only to an ISOLATED managed proxy service that supplies HTTPS.
      return gateway.start({host:'0.0.0.0',port:httpConfig.port});
    },
    stop:()=>gateway.stop()
  });
}
