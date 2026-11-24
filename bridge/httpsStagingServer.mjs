/**
 * Separate staging HTTPS service composition. Only for a dedicated TLS
 * terminating managed reverse proxy (e.g. an isolated Render web service).
 * NO deployment side effects occur by importing or constructing this module.
 *
 * Both explicit gates are required: staging Supabase and public HTTPS proxy.
 * In particular, FreePT production Supabase is rejected by shared validator.
 */
import {authE2EEnabled,runStagingAuthE2E} from './stagingAuthE2E.mjs';
import {stagingTestConsoleAssets,TEST_CONSOLE_ORIGIN} from './stagingTestConsole.mjs';
import {createBootstrapHandler} from './bootstrapHandler.mjs';
import {createClient} from '@supabase/supabase-js';
import {createBridgeOwnerEnrollmentHandler} from './ownerEnrollment.mjs';
import {createTrustedBridgeBackend} from './trustedBackend.mjs';
import {validateBridgeStagingConfig} from './stagingServer.mjs';
import {createBridgeHttpsGateway,validateBridgeGatewayConfig} from './httpsGateway.mjs';
import {stagingBridgeDiagnostics} from './requestDiagnostics.mjs';

export function createBridgeStagingHttpsService({
  env,createClientFn=createClient,diagnosticOptions
}={}){
  const dbConfig=validateBridgeStagingConfig(env);
  const httpConfig=validateBridgeGatewayConfig(env);
  const diagnostics=stagingBridgeDiagnostics(env,diagnosticOptions);
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
  const bootstrap=env.FREEPT_BRIDGE_BOOTSTRAP==='STAGING_DEVICE_KEY_V1'
    ?createBootstrapHandler({authClient,db:serviceClient,enabled:true}):null;
  const staticAssets=stagingTestConsoleAssets(env,dbConfig);
  const runAuthE2E=authE2EEnabled(env,dbConfig);
  if(runAuthE2E&&!staticAssets)throw Error('auth_e2e_console_required');
  const publish=report=>staticAssets.set('/test/server-e2e.json',{type:'application/json; charset=utf-8',body:JSON.stringify(report),csp:"default-src 'none'"});
  if(runAuthE2E)publish({phase:'starting'});
  const config=staticAssets?{...httpConfig,origins:[...new Set([...httpConfig.origins,TEST_CONSOLE_ORIGIN])]}:httpConfig;
  const gateway=createBridgeHttpsGateway({admin,tx,owner,bootstrap,config,staticAssets,diagnostics});
  return Object.freeze({
    async start(){
      // Bound only to an ISOLATED managed proxy service that supplies HTTPS.
      const address=await gateway.start({host:'0.0.0.0',port:httpConfig.port});
      if(runAuthE2E)void runStagingAuthE2E({config:dbConfig,publish}).then(r=>console.log('staging_auth_e2e',r.phase)).catch(()=>publish({phase:'failed',failure:'runner_failed',completeEndToEnd:false}));
      return address;
    },
    stop:()=>gateway.stop()
  });
}
