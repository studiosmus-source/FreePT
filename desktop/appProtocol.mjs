import fs from 'node:fs/promises';
import path from 'node:path';

const MIME=Object.freeze({
  '.css':'text/css; charset=utf-8','.html':'text/html; charset=utf-8',
  '.ico':'image/x-icon','.jpeg':'image/jpeg','.jpg':'image/jpeg',
  '.js':'text/javascript; charset=utf-8','.json':'application/json',
  '.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp',
  '.woff':'font/woff','.woff2':'font/woff2'
});

function reply(body,status=200,type='text/plain; charset=utf-8'){
  return new Response(body,{status,headers:{
    'content-type':type,'cache-control':'no-store',
    'x-content-type-options':'nosniff'
  }});
}

export function createAppAssetHandler({appRoot,fsApi=fs}={}){
  if(typeof appRoot!=='string'||!appRoot)throw Error('desktop_asset_root_invalid');
  const root=path.resolve(appRoot);
  return async function serve(request){
    if(request?.method!=='GET'&&request?.method!=='HEAD')
      return reply('not allowed',405);
    let target;
    try{
      const url=new URL(request.url);
      if(url.hostname!=='localhost')return reply('not found',404);
      const pathname=decodeURIComponent(url.pathname||'/');
      const relative=pathname==='/'?'index.html':pathname.replace(/^\/+/,'');
      target=path.resolve(root,relative);
    }catch{return reply('not found',404);}
    if(target!==root&&!target.startsWith(root+path.sep))
      return reply('not found',404);
    try{
      const stat=await fsApi.stat(target);
      if(!stat.isFile())return reply('not found',404);
      return reply(
        request.method==='HEAD'?null:await fsApi.readFile(target),
        200,MIME[path.extname(target).toLowerCase()]||'application/octet-stream'
      );
    }catch{return reply('not found',404);}
  };
}
