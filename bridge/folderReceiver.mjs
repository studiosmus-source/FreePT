/**
 * Experimental Bridge receiver: discover and reconstruct an authorized SAF tree.
 * No network or Android storage access is performed here. The caller must bind
 * every listPage request to a live grant/session and implement destination
 * staging so discard() removes the whole partial directory on failure.
 */
import {validateBridgeFolderPage, BRIDGE_FILE_LIMITS} from '../src/bridgeFileProtocol.js';

const HANDLE=/^(?:root|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const cancelled = signal => { if(signal?.aborted) throw Error('bridge_transfer_cancelled'); };

export async function planBridgeFolder({root='root',listPage,signal,maxEntries=BRIDGE_FILE_LIMITS.maxTotalEntries}={}) {
  if(!HANDLE.test(root)||typeof listPage!=='function'||
     !Number.isSafeInteger(maxEntries)||maxEntries<1||maxEntries>BRIDGE_FILE_LIMITS.maxTotalEntries)
    throw Error('bridge_folder_plan_invalid_options');
  const pending=[{handle:root,path:[],depth:0}];
  const knownHandles=new Set([root]);
  const items=[];
  for(let index=0;index<pending.length;index++) {
    const parent=pending[index];
    cancelled(signal);
    let offset=0;
    const names=new Set();
    const offsets=new Set();
    for(;;){
      cancelled(signal);
      if(offsets.has(offset))throw Error('bridge_folder_pagination_loop');
      offsets.add(offset);
      const page=validateBridgeFolderPage(await listPage({handle:parent.handle,offset}));
      cancelled(signal);
      for(const entry of page.entries){
        const normalized=entry.name.normalize('NFC').toLocaleLowerCase('en-US');
        if(names.has(normalized))throw Error('bridge_folder_duplicate_name');
        names.add(normalized);
        if(knownHandles.has(entry.handle))throw Error('bridge_folder_handle_reused');
        knownHandles.add(entry.handle);
        if(items.length>=maxEntries)throw Error('bridge_folder_entry_limit');
        const path=[...parent.path,entry.name];
        if(path.length>BRIDGE_FILE_LIMITS.maxDepth)throw Error('bridge_folder_depth_limit');
        if(!entry.directory && entry.size<0)throw Error('bridge_folder_unknown_file_size');
        const item=Object.freeze({handle:entry.handle,path:Object.freeze(path),directory:entry.directory,size:entry.size,mime:entry.mime});
        items.push(item);
        if(entry.directory){
          if(path.length>=BRIDGE_FILE_LIMITS.maxDepth)throw Error('bridge_folder_depth_limit');
          pending.push({handle:entry.handle,path,depth:path.length});
        }
      }
      if(page.nextOffset===-1)break;
      if(page.nextOffset<=offset)throw Error('bridge_folder_pagination_loop');
      offset=page.nextOffset;
    }
  }
  return Object.freeze(items);
}

/** Whole-directory atomicity must be supplied by the Android destination adapter. */
export async function receiveBridgeFolder({root,listPage,begin,makeDirectory,downloadFile,commit,discard,signal,maxEntries}={}){
  if([begin,makeDirectory,downloadFile,commit,discard].some(fn=>typeof fn!=='function'))
    throw Error('bridge_folder_destination_invalid');
  const manifest=await planBridgeFolder({root,listPage,signal,maxEntries});
  let started=false,done=false;
  try{
    cancelled(signal);
    started=true;
    await begin();
    for(const item of manifest){
      cancelled(signal);
      if(item.directory)await makeDirectory(item.path);
      else await downloadFile({handle:item.handle,path:item.path,size:item.size,mime:item.mime,signal});
    }
    cancelled(signal);
    await commit();
    done=true;
    return {entries:manifest.length,files:manifest.filter(item=>!item.directory).length};
  }finally{
    if(started&&!done)await discard();
  }
}
