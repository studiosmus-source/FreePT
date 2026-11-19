/** Temporary test-only login surface. Publishes no server-side credentials. */
import {readFileSync} from 'node:fs';
const TEST='https://aqjuixbuxftnjfzxmzuj.supabase.co';
export const TEST_CONSOLE_ORIGIN='https://freept-bridge-staging.onrender.com';
export function stagingTestConsoleAssets(env,dbConfig){
 if(env?.FREEPT_BRIDGE_TEST_CONSOLE!=='AUTH_E2E_ONLY')return null;
 if(env.FREEPT_BRIDGE_BOOTSTRAP!=='STAGING_DEVICE_KEY_V1'||dbConfig.url!==TEST)
  throw Error('test_console_isolated_bootstrap_required');
 const assets=new Map();
 const add=(path,type,body)=>assets.set(path,Object.freeze({type,body,csp:"default-src 'none'; script-src 'self'; connect-src 'self' "+TEST+"; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"}));
 add('/test/','text/html; charset=utf-8',readFileSync(new URL('./test-console/index.html',import.meta.url),'utf8'));
 for(const file of ['console.mjs','protocol.mjs'])add('/test/'+file,'text/javascript; charset=utf-8',readFileSync(new URL('./test-console/'+file,import.meta.url),'utf8'));
 add('/test/config.mjs','text/javascript; charset=utf-8','export const config=Object.freeze('+JSON.stringify({supabase:dbConfig.url,publishable:dbConfig.publishable})+');\n');
 return assets;
}
