/**
 * Dedicated read-only OTA metadata server. No database, chat, credentials,
 * Bridge routes, upload endpoints or remote filesystem operations.
 * ZIP assets are immutable GitHub Release files; promotion is a separate act.
 */
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {chooseUpdate,validateRelease,parseTestDeviceIds} from './releaseProtocol.mjs';

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
export function createOtaServer({stable=null,test=null,testDeviceIds=new Set(),allowLocalHttp=false}={}){
  return createServer(async(req,res)=>{
    // Ignore tracking query parameters on read-only status pages only.
    // Keep the OTA POST path strict: no query parameters accepted.
    const path=typeof req.url==='string'?req.url.split('?',1)[0]:'';
    if((path==='/'||path==='/health'||path==='/health/')&&req.method==='GET'){
      respond(res,200,{status:'ok'});return;
    }
    if(req.url!=='/updates'){respond(res,404,{error:'not_found'});return;}
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
    if(sizeHeader&&Number(sizeHeader)>4096){respond(res,413,{error:'too_large'});return;}
    let size=0,parts=[];
    try{
      for await(const part of req){
        size+=part.length;
        if(size>4096)throw Error('too_large');
        parts.push(part);
      }
      const info=JSON.parse(Buffer.concat(parts).toString('utf8'));
      if(!info||typeof info!=='object'||Array.isArray(info)){
        respond(res,400,{error:'invalid_request'});return;
      }
      respond(res,200,chooseUpdate(info,{stable,test,testDeviceIds}));
    }catch(error){
      respond(res,error?.message==='too_large'?413:400,{
        error:error?.message==='too_large'?'too_large':'invalid_request'
      });
    }
  });
}
async function main(){
  if(process.env.FREEPT_OTA_ENABLED!=='I_ACCEPT_FREEPT_OTA_SERVER')
    throw Error('ota_server_explicit_opt_in_required');
  const port=Number(process.env.PORT);
  if(!Number.isSafeInteger(port)||port<1||port>65535)
    throw Error('ota_server_port_invalid');
  const root=fileURLToPath(new URL('./',import.meta.url));
  const [stableJson,testJson]=await Promise.all([
    readFile(resolve(root,'manifests/stable.json'),'utf8'),
    readFile(resolve(root,'manifests/test.json'),'utf8')
  ]);
  const server=createOtaServer({
    stable:validateRelease(JSON.parse(stableJson)),
    test:validateRelease(JSON.parse(testJson)),
    testDeviceIds:parseTestDeviceIds(process.env.FREEPT_OTA_TEST_DEVICE_IDS||'')
  });
  await new Promise((ok,fail)=>server.once('error',fail).listen(port,'0.0.0.0',ok));
  console.log('FreePT OTA metadata service ready on port',port);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{console.error(error.message);process.exitCode=1;});
