/**
 * HTTPS reverse-proxy-only Bridge HTTP gateway for a DEDICATED staging service.
 * Not a TX replacement. No client-provided service keys, no filesystem access.
 *
 * The platform MUST terminate TLS and overwrite x-forwarded-proto. Deploy only
 * to a separate Render service with no direct listener bypassing the proxy.
 * Origin allowlisting is browser isolation; bearer/session+database grants
 * remain the actual authorization.
 */
import {createServer} from 'node:http';

const ROUTES=Object.freeze({
  '/bridge/admin/list':'admin',
  '/bridge/admin/read':'admin',
  '/bridge/admin/browse':'admin',
  '/bridge/admin/browse-page':'admin',
  '/bridge/admin/chunk':'admin',
  '/bridge/admin/status':'admin',
  '/bridge/admin/cancel':'admin',
  '/bridge/admin/folder':'admin',
  '/bridge/owner/enroll':'owner',
  '/bridge/owner/delete':'owner',
  '/bridge/tx/connect':'tx',
  '/bridge/tx/poll':'tx',
  '/bridge/tx/complete':'tx',
  '/bridge/tx/folder':'tx',
  '/bridge/tx/chunk':'tx',
  '/bridge/tx/browse':'tx',
  '/bridge/tx/disconnect':'tx'
});
const MAX_SMALL=2048;
const MAX_CATALOGUE=32768;
const MAX_RESPONSE=65536;
const fail=(status,error)=>({status,body:{error}});
const jsonType=header=>typeof header==='string'&&header.split(';')[0].trim().toLowerCase()==='application/json';
export function validateBridgeGatewayConfig(env={},mode='staging'){
  if(!['staging','production'].includes(mode))throw Error('bridge_gateway_mode_invalid');
  const expected=mode==='production'?'I_ACCEPT_PRODUCTION_BRIDGE':'I_UNDERSTAND_STAGING_HTTPS_ONLY';
  if(env.FREEPT_BRIDGE_PUBLIC!==expected)
    throw Error('bridge_gateway_opt_in_required');
  const origins=env.FREEPT_BRIDGE_ALLOWED_ORIGINS?.split(',').map(x=>x.trim())||[];
  if(!origins.length||origins.length>5||origins.some(raw=>{
    try{
      const url=new URL(raw);
      return !(url.protocol==='https:'||(mode==='production'&&raw==='http://localhost'))||url.origin!==raw||url.username||
        url.password||url.port||url.hash||url.search||
        url.pathname!=='/'||raw.includes('*');
    }catch{return true;}
  })||new Set(origins).size!==origins.length)
    throw Error('bridge_gateway_origins_invalid');
  const port=Number(env.PORT);
  if(!Number.isSafeInteger(port)||port<1||port>65535)
    throw Error('bridge_gateway_port_invalid');
  return Object.freeze({origins:Object.freeze(origins),port});
}
function write(res,status,body,origin){
  if(res.writableEnded||res.destroyed)return;
  const headers={
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store',
    'x-content-type-options':'nosniff',
    'referrer-policy':'no-referrer',
    'vary':'Origin',
    'content-security-policy':"default-src 'none'"
  };
  if(origin)headers['access-control-allow-origin']=origin;
  res.writeHead(status,headers);
  res.end(JSON.stringify(body));
}
async function readJson(req,limit){
  if(!jsonType(req.headers['content-type']))return {error:fail(415,'unsupported_media_type')};
  const length=req.headers['content-length'];
  if(length!==undefined&&(!/^\d+$/.test(length)||Number(length)>limit))
    return {error:fail(413,'payload_too_large')};
  let bytes=0;const chunks=[];
  try{
    for await(const part of req){
      bytes+=part.length;
      if(bytes>limit)return {error:fail(413,'payload_too_large')};
      chunks.push(part);
    }
    const parsed=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))
      return {error:fail(400,'invalid_request')};
    return {body:parsed};
  }catch{return {error:fail(400,'invalid_json')};}
}
export function createBridgeHttpsGateway({
  admin,owner,tx,config,
  allowHttpInUnitTests=false,now=()=>Date.now()
}={}){
  if(typeof admin!=='function'||typeof owner!=='function'||typeof tx!=='function'||
     !config||!Array.isArray(config.origins)||config.origins.length===0||
     typeof now!=='function')
    throw Error('bridge_gateway_dependencies_invalid');
  const origins=new Set(config.origins);
  let windowStart=now(),globalCount=0;
  const server=createServer(async(req,res)=>{
    const rawOrigin=req.headers.origin;
    const origin=typeof rawOrigin==='string'&&origins.has(rawOrigin)?rawOrigin:null;
    if(rawOrigin!==undefined&&!origin){
      write(res,403,{error:'origin_denied'},null);return;
    }
    if(!allowHttpInUnitTests&&
       !(req.socket.encrypted||req.headers['x-forwarded-proto']==='https')){
      write(res,403,{error:'https_required'},origin);return;
    }
    if(req.url==='/health'&&req.method==='GET'){
      write(res,200,{status:'ok'},origin);return;
    }
    const route=ROUTES[req.url];
    if(!route){write(res,404,{error:'not_found'},origin);return;}
    if(req.method==='OPTIONS'){
      // Never permit arbitrary origins or credential-bearing wildcard CORS.
      if(!origin){write(res,403,{error:'origin_denied'},null);return;}
      res.writeHead(204,{
        'access-control-allow-origin':origin,
        'access-control-allow-methods':'POST',
        'access-control-allow-headers':'authorization,content-type',
        'access-control-max-age':'300',
        'cache-control':'no-store',
        'vary':'Origin'
      });res.end();return;
    }
    if(req.method!=='POST'){write(res,405,{error:'method_not_allowed'},origin);return;}
    const time=now();
    if(time-windowStart>=60000){windowStart=time;globalCount=0;}
    if(++globalCount>180){write(res,429,{error:'rate_limited'},origin);return;}
    const parsed=await readJson(req,req.url==='/bridge/tx/chunk'?49152:(req.url==='/bridge/tx/folder'||req.url==='/bridge/tx/browse')?MAX_CATALOGUE:MAX_SMALL);
    if(parsed.error){write(res,parsed.error.status,parsed.error.body,origin);return;}
    try{
      const handler=route==='admin'?admin:route==='tx'?tx:owner;
      const response=await handler({
        method:'POST',path:req.url,
        headers:{authorization:req.headers.authorization},
        body:parsed.body
      });
      if(!response||!Number.isInteger(response.status)||response.status<200||
         response.status>599||!response.body||typeof response.body!=='object')
        throw Error('bridge_gateway_invalid_handler');
      const output=JSON.stringify(response.body);
      if(Buffer.byteLength(output)>MAX_RESPONSE){
        write(res,502,{error:'response_too_large'},origin);return;
      }
      write(res,response.status,response.body,origin);
    }catch{
      write(res,503,{error:'bridge_unavailable'},origin);
    }
  });
  server.requestTimeout=15000;
  server.headersTimeout=10000;
  server.keepAliveTimeout=3000;
  return Object.freeze({
    async start({host='127.0.0.1',port=0}={}){
      if(server.listening)throw Error('bridge_gateway_already_started');
      await new Promise((resolve,reject)=>{
        server.once('error',reject);
        server.listen(port,host,resolve);
      });
      return server.address();
    },
    async stop(){
      if(server.listening)await new Promise((resolve,reject)=>
        server.close(error=>error?reject(error):resolve()));
    }
  });
}
