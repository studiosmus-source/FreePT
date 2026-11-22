import {constants as fsConstants} from 'node:fs';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {
  BRIDGE_FILE_LIMITS,
  validateBridgeReadRequest
} from '../src/bridgeFileProtocol.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIRECTORY_MIME='vnd.android.document/directory';
const SNAPSHOT_TTL_MS=60_000;
const MIME_BY_EXTENSION=Object.freeze({
  '.avif':'image/avif','.bmp':'image/bmp','.gif':'image/gif',
  '.heic':'image/heic','.jpeg':'image/jpeg','.jpg':'image/jpeg',
  '.m4a':'audio/mp4','.mp3':'audio/mpeg','.mp4':'video/mp4',
  '.pdf':'application/pdf','.png':'image/png','.svg':'image/svg+xml',
  '.txt':'text/plain','.webp':'image/webp','.zip':'application/zip'
});

function isWithin(root,candidate){
  const relative=path.relative(root,candidate);
  return relative===''||
    (!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep));
}
function safeName(name){
  return typeof name==='string'&&name.length>0&&
    name.length<=BRIDGE_FILE_LIMITS.maxName&&
    !/[\\/\u0000-\u001f\u007f]/u.test(name)&&name!=='.'&&name!=='..';
}
function mimeFor(name,directory){
  if(directory)return DIRECTORY_MIME;
  return MIME_BY_EXTENSION[path.extname(name).toLowerCase()]||'application/octet-stream';
}

/**
 * Read-only view of one user-selected directory for the desktop Bridge.
 * Handles are opaque and never contain local paths. Hidden entries are kept;
 * symlinks are followed only when their target remains inside the selected root.
 */
export async function createBridgeDesktopFolderProvider({
  root,roots,fsApi=fs,uuid=randomUUID,now=()=>Date.now()
}={}){
  const requestedRoots=Array.isArray(roots)?roots:[root];
  if(!requestedRoots.length||requestedRoots.some(value=>
       typeof value!=='string'||!value.trim())||typeof uuid!=='function'||
     typeof now!=='function')throw Error('bridge_desktop_root_invalid');
  const authorizedRoots=[];
  for(const selected of requestedRoots){
    let selectedPath=path.resolve(selected),selectedName;
    try{
      selectedPath=await fsApi.realpath(selectedPath);
      const selectedInfo=await fsApi.stat(selectedPath);
      if(!selectedInfo.isDirectory())throw Error('bridge_desktop_root_invalid');
    }catch(error){
      if(error?.message==='bridge_desktop_root_invalid')throw error;
      // Keep a previously selected removable volume even while it is offline.
    }
    selectedName=path.basename(selectedPath)||path.parse(selectedPath).root||selectedPath;
    if(!authorizedRoots.some(item=>item.path===selectedPath))
      authorizedRoots.push({path:selectedPath,name:selectedName});
  }
  const withinAuthorizedRoot=candidate=>
    authorizedRoots.some(item=>isWithin(item.path,candidate));

  const handles=new Map([['root',{
    path:null,directory:true,virtualRoot:true,ancestors:new Set()
  }]]);
  const handlesByPath=new Map();
  const snapshots=new Map();

  function newHandle(entry){
    const existing=entry.alias?null:handlesByPath.get(entry.path);
    if(existing)return existing;
    let handle;
    do{handle=uuid();}while(!UUID.test(handle)||handles.has(handle));
    handles.set(handle,entry);
    if(!entry.alias)handlesByPath.set(entry.path,handle);
    return handle;
  }

  async function directoryFor(handle){
    if(handle!=='root'&&!UUID.test(handle))throw Error('bridge_desktop_handle_invalid');
    const entry=handles.get(handle);
    if(!entry||!entry.directory)throw Error('bridge_desktop_handle_invalid');
    if(entry.virtualRoot)return entry;
    let actual;
    try{actual=await fsApi.realpath(entry.path);}catch{throw Error('bridge_desktop_file_unavailable');}
    if(!withinAuthorizedRoot(actual))throw Error('bridge_desktop_path_denied');
    const info=await fsApi.stat(actual);
    if(!info.isDirectory())throw Error('bridge_desktop_file_unavailable');
    return {...entry,path:actual};
  }

  async function makeSnapshot(handle,parent){
    if(parent.virtualRoot){
      return authorizedRoots.map(selected=>{
        const selectedHandle=newHandle({
          path:selected.path,directory:true,ancestors:new Set([selected.path])
        });
        return {
          handle:selectedHandle,name:selected.name,directory:true,size:-1,
          mime:DIRECTORY_MIME
        };
      }).sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:'base'})||
        a.name.localeCompare(b.name));
    }
    const cached=snapshots.get(handle);
    if(cached&&cached.path===parent.path&&now()-cached.createdAt<SNAPSHOT_TTL_MS)
      return cached.entries;
    let names;
    try{names=await fsApi.readdir(parent.path);}catch{
      throw Error('bridge_desktop_directory_unavailable');
    }
    const entries=[];
    for(const name of names){
      if(!safeName(name))continue;
      const localPath=path.join(parent.path,name);
      try{
        const linkInfo=await fsApi.lstat(localPath);
        const actualPath=await fsApi.realpath(localPath);
        if(!withinAuthorizedRoot(actualPath))continue;
        const info=await fsApi.stat(actualPath);
        const directory=info.isDirectory();
        if(!directory&&!info.isFile())continue;
        if(directory&&parent.ancestors.has(actualPath))continue;
        if(!directory&&(!Number.isSafeInteger(info.size)||
           info.size<0||info.size>BRIDGE_FILE_LIMITS.maxFileBytes))continue;
        const alias=linkInfo.isSymbolicLink();
        const ancestors=new Set(parent.ancestors);
        if(directory)ancestors.add(actualPath);
        const handleId=newHandle({
          path:actualPath,directory,ancestors,alias
        });
        entries.push({
          handle:handleId,name,directory,size:directory?-1:info.size,
          mime:mimeFor(name,directory)
        });
      }catch{
        // A file can become unreadable or disappear while a directory is listed.
      }
    }
    entries.sort((a,b)=>
      Number(b.directory)-Number(a.directory)||
      a.name.localeCompare(b.name,undefined,{sensitivity:'base'})||
      a.name.localeCompare(b.name)
    );
    snapshots.set(handle,{path:parent.path,createdAt:now(),entries});
    return entries;
  }

  return Object.freeze({
    async list({handle='root',offset=0}={}){
      if(!Number.isSafeInteger(offset)||offset<0||
         offset>BRIDGE_FILE_LIMITS.maxTotalEntries)
        throw Error('bridge_desktop_offset_invalid');
      const parent=await directoryFor(handle);
      const entries=await makeSnapshot(handle,parent);
      const page=entries.slice(offset,offset+BRIDGE_FILE_LIMITS.pageSize);
      const nextOffset=offset+page.length<entries.length
        ?offset+page.length:-1;
      return {entries:page,nextOffset};
    },
    async readChunk(request){
      const checked=validateBridgeReadRequest(request);
      const entry=handles.get(checked.handle);
      if(!entry||entry.directory)throw Error('bridge_desktop_handle_invalid');
      let actual;
      try{actual=await fsApi.realpath(entry.path);}catch{
        throw Error('bridge_desktop_file_unavailable');
      }
      if(!withinAuthorizedRoot(actual))throw Error('bridge_desktop_path_denied');
      let before;
      try{before=await fsApi.stat(actual);}catch{
        throw Error('bridge_desktop_file_unavailable');
      }
      if(!before.isFile()||before.size>BRIDGE_FILE_LIMITS.maxFileBytes||
         checked.offset+checked.length>before.size)
        throw Error('bridge_desktop_file_changed');
      const noFollow=typeof fsConstants.O_NOFOLLOW==='number'?fsConstants.O_NOFOLLOW:0;
      let file;
      try{file=await fsApi.open(actual,fsConstants.O_RDONLY|noFollow);}catch{
        throw Error('bridge_desktop_file_unavailable');
      }
      try{
        const opened=await file.stat();
        if(!opened.isFile()||opened.size<checked.offset+checked.length||
           (before.dev&&opened.dev&&before.dev!==opened.dev)||
           (before.ino&&opened.ino&&before.ino!==opened.ino))
          throw Error('bridge_desktop_file_changed');
        const buffer=Buffer.alloc(checked.length);
        let bytesRead=0;
        while(bytesRead<buffer.length){
          const result=await file.read(
            buffer,bytesRead,buffer.length-bytesRead,checked.offset+bytesRead
          );
          if(result.bytesRead===0)break;
          bytesRead+=result.bytesRead;
        }
        if(bytesRead!==checked.length)throw Error('bridge_desktop_file_changed');
        const stillAtPath=await fsApi.realpath(entry.path);
        if(stillAtPath!==actual||!withinAuthorizedRoot(stillAtPath))
          throw Error('bridge_desktop_path_denied');
        return {
          base64:buffer.toString('base64'),bytesRead,
          eof:checked.offset+bytesRead>=opened.size
        };
      }finally{await file.close();}
    },
    close(){
      handles.clear();handlesByPath.clear();snapshots.clear();
      return true;
    }
  });
}
