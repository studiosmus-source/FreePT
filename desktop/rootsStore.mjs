import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export function createDesktopRootsStore({filePath,fsApi=fs,uuid=randomUUID}={}){
  if(typeof filePath!=='string'||!filePath||typeof uuid!=='function')
    throw Error('bridge_desktop_roots_store_invalid');

  async function read(){
    let value;
    try{value=JSON.parse(await fsApi.readFile(filePath,'utf8'));}
    catch(error){
      if(error?.code==='ENOENT')return [];
      throw Error('bridge_desktop_roots_unavailable');
    }
    if(value?.version!==1||!Array.isArray(value.roots)||
       value.roots.some(root=>typeof root!=='string'||!path.isAbsolute(root)))
      throw Error('bridge_desktop_roots_unavailable');
    return [...new Set(value.roots)];
  }

  async function write(roots){
    await fsApi.mkdir(path.dirname(filePath),{recursive:true,mode:0o700});
    const temporary=filePath+'.'+uuid()+'.tmp';
    try{
      await fsApi.writeFile(temporary,JSON.stringify({version:1,roots}),{
        encoding:'utf8',mode:0o600,flag:'wx'
      });
      await fsApi.rename(temporary,filePath);
    }catch(error){
      try{await fsApi.unlink(temporary);}catch{}
      throw error;
    }
  }

  return Object.freeze({
    get:read,
    async replace(selected){
      if(!Array.isArray(selected)||!selected.length||
         selected.some(item=>typeof item!=='string'||!item.trim()))
        throw Error('bridge_desktop_roots_invalid');
      const roots=[];
      for(const selectedPath of selected){
        let canonical;
        try{
          canonical=await fsApi.realpath(selectedPath);
          if(!(await fsApi.stat(canonical)).isDirectory())continue;
        }catch{continue;}
        if(!roots.includes(canonical))roots.push(canonical);
      }
      if(!roots.length)throw Error('bridge_desktop_roots_invalid');
      await write(roots);
      return {saved:true,count:roots.length};
    },
    async clear(){
      await write([]);
      return {cleared:true};
    }
  });
}
