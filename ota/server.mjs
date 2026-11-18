/**
 * Dedicated read-only OTA metadata server. No database, chat, credentials,
 * Bridge routes, upload endpoints or remote filesystem operations.
 * Immutable GitHub Release assets; promotion is a separate act.
 *
 * Two independent channels, both read-only metadata only:
 *   POST /updates      -> Capgo web-bundle (.zip) channel  (releaseProtocol.mjs)
 *   POST /apk-update    -> full-APK (.apk) channel          (apkReleaseProtocol.mjs)
 * The APK channel is what updates native code (Bridge TX, permissions, icons).
 */
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {chooseUpdate,validateRelease,parseTestDeviceIds} from './releaseProtocol.mjs';
import {chooseApkUpdate,validateApkRelease} from './apkReleaseProtocol.mjs';

const MAX_BODY=4096;

function respond(res,code,body){
  res.writeHead(code,{
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store','x-content-type-options':'nosniff',
    'content-security-policy':"default-src 'none'",
    'access-control-allow-origin':'*',
    'access-control-allow-methods':'POST, OPTIONS',
    'access-control-allow-headers':'content-type'
  });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req){
  let size=0;const parts=[];
  for await(const part of req){
    size+=part.length;
    if(size>MAX_BODY)throw Error('too_large');
    parts.push(part);
  }
  const info=JSON.parse(Buffer.concat(parts).toString('utf8'));
  if(!info||typeof info!=='object'||Array.isArray(info))throw Error('invalid_request');
  return info;
}

export function createOtaServer({
  stable=null,test=null,testDeviceIds=new Set(),
  apkStable=null,apkTest=null,apkTestDeviceIds=null,
  allowLocalHttp=false
}={}){
  // APK TEST allowlist defaults to the same set as the web channel unless
  // a distinct set is supplied, so a single env var can drive both.
  const apkTesters=apkTestDeviceIds||testDeviceIds;
  return createServer(async(req,res)=>{
    const path=typeof req.url==='string'?req.url.split('?',1)[0]:'';
    if((path==='/'||path==='/health'||path==='/health/')&&req.method==='GET'){
      respond(res,200,{status:'ok'});return;
    }
    // Strict: the POST channels accept no query parameters.
    const channel=req.url==='/updates'?'web':req.url==='/apk-update'?'apk':null;
    if(!channel){respond(res,404,{error:'not_found'});return;}
    if(req.method==='OPTIONS'){respond(res,204,{});return;}
    if(req.method!=='POST'){respond(res,405,{error:'method_not_allowed'});return;}
    if(!allowLocalHttp&&req.headers['x-forwarded-proto']!=='https'&&!req.socket.encrypted){
      respond(res,403,{error:'https_required'});return;
    }
    if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||'')){
      respond(res,415,{error:'json_required'});return;
    }
    const sizeHeader=req.headers['content-length'];
    if(sizeHeader&&!/^[0-9]+$/.test(sizeHeader)){respond(res,400,{error:'bad_length'});return;}
    if(sizeHeader&&Number(sizeHeader)>MAX_BODY){respond(res,413,{error:'too_large'});return;}
    try{
      const info=await readJsonBody(req);
      respond(res,200,channel==='web'
        ?chooseUpdate(info,{stable,test,testDeviceIds})
        :chooseApkUpdate(info,{stable:apkStable,test:apkTest,testDeviceIds:apkTesters}));
    }catch(error){
      respond(res,error?.message==='too_large'?413:400,{
        error:error?.message==='too_large'?'too_large':'invalid_request'
      });
    }
  });
}

async function readManifest(root,name,validate){
  try{
    return validate(JSON.parse(await readFile(resolve(root,name),'utf8')));
  }catch(error){
    // A missing APK manifest simply disables that channel; a malformed one is fatal.
    if(error&&error.code==='ENOENT')return null;
    throw error;
  }
}

async function main(){
  if(process.env.FREEPT_OTA_ENABLED!=='I_ACCEPT_FREEPT_OTA_SERVER')
    throw Error('ota_server_explicit_opt_in_required');
  const port=Number(process.env.PORT);
  if(!Number.isSafeInteger(port)||port<1||port>65535)
    throw Error('ota_server_port_invalid');
  const root=fileURLToPath(new URL('./',import.meta.url));
  const [stable,test,apkStable,apkTest]=await Promise.all([
    readManifest(root,'manifests/stable.json',validateRelease),
    readManifest(root,'manifests/test.json',validateRelease),
    readManifest(root,'manifests/apk-stable.json',validateApkRelease),
    readManifest(root,'manifests/apk-test.json',validateApkRelease)
  ]);
  const server=createOtaServer({
    stable,test,apkStable,apkTest,
    testDeviceIds:parseTestDeviceIds(process.env.FREEPT_OTA_TEST_DEVICE_IDS||''),
    apkTestDeviceIds:process.env.FREEPT_OTA_APK_TEST_DEVICE_IDS
      ?parseTestDeviceIds(process.env.FREEPT_OTA_APK_TEST_DEVICE_IDS):null
  });
  await new Promise((ok,fail)=>server.once('error',fail).listen(port,'0.0.0.0',ok));
  console.log('FreePT OTA metadata service ready on port',port);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{console.error(error.message);process.exitCode=1;});
