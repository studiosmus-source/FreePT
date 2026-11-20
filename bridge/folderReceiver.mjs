/**
 * Experimental Bridge receiver: discover and reconstruct an authorized SAF tree.
 * No network or Android storage access is performed here. The caller must bind
 * every listPage request to a live grant/session and implement destination
 * staging. Unrecoverable failures roll back. Explicit cancellation or an
 * approved transient read failure can retain ONLY verified complete files,
 * prominently identified as a partial folder.
 */
import {validateBridgeFolderPage, BRIDGE_FILE_LIMITS} from '../src/bridgeFileProtocol.js';

const HANDLE=/^(?:root|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const cancelled = signal => { if(signal?.aborted) throw Error('bridge_transfer_cancelled'); };
// These are read/transport failures, NOT authorization, malformed content,
// data-integrity, destination filesystem or final-publication failures.
const transientReadErrors=new Set([
  'bridge_backend_unavailable','bridge_network_unavailable',
  'bridge_request_throttled','bridge_request_failed',
  'bridge_device_unavailable','bridge_download_timeout',
  'bridge_download_job_cancelled'
]);
const verifiedPlans=new WeakSet();
export function summarizeBridgeFolder(manifest){
  if(!verifiedPlans.has(manifest))throw Error('bridge_folder_plan_unverified');
  let files=0,directories=0,hidden=0,totalBytes=0;
  for(const item of manifest){
    if(item.directory)directories++;
    else {files++;totalBytes+=item.size;}
    if(item.path.some(segment=>segment.startsWith('.')))hidden++;
  }
  return Object.freeze({entries:manifest.length,files,directories,hidden,totalBytes});
}

export async function planBridgeFolder({
  root='root',listPage,signal,maxEntries=BRIDGE_FILE_LIMITS.maxTotalEntries,
  onScanProgress=()=>{}
}={}) {
  if(!HANDLE.test(root)||typeof listPage!=='function'||
     typeof onScanProgress!=='function'||
     !Number.isSafeInteger(maxEntries)||maxEntries<1||maxEntries>BRIDGE_FILE_LIMITS.maxTotalEntries)
    throw Error('bridge_folder_plan_invalid_options');
  const pending=[{handle:root,path:[],depth:0}];
  const knownHandles=new Set([root]);
  const items=[];
  let scannedPages=0,foundFiles=0;
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
        if(!entry.directory)foundFiles++;
        if(entry.directory){
          if(path.length>=BRIDGE_FILE_LIMITS.maxDepth)throw Error('bridge_folder_depth_limit');
          pending.push({handle:entry.handle,path,depth:path.length});
        }
      }
      scannedPages++;
      cancelled(signal);
      onScanProgress(Object.freeze({
        scannedPages,scannedFolders:index+1,
        pendingFolders:pending.length-(index+1),
        foundEntries:items.length,foundFiles
      }));
      if(page.nextOffset===-1)break;
      if(page.nextOffset<=offset)throw Error('bridge_folder_pagination_loop');
      offset=page.nextOffset;
    }
  }
  const manifest=Object.freeze(items);
  verifiedPlans.add(manifest);
  return manifest;
}

/**
 * Validate the entire authorized inventory before creating local files.
 * A plan supplied by the UI must be one built by this module, not arbitrary
 * unverified file handles or paths.
 */
export async function receiveBridgeFolder({
  root,listPage,manifest=null,begin,makeDirectory,downloadFile,commit,discard,
  signal,maxEntries,onScanProgress=()=>{},onStage=()=>{},
  preserveCompletedOnCancel=false,preserveCompletedOnFailure=false
}={}){
  if([begin,makeDirectory,downloadFile,commit,discard,onScanProgress,onStage]
      .some(fn=>typeof fn!=='function')||typeof preserveCompletedOnCancel!=='boolean'||
      typeof preserveCompletedOnFailure!=='boolean')
    throw Error('bridge_folder_destination_invalid');
  let source=manifest;
  if(source!==null){
    if(!verifiedPlans.has(source)||maxEntries!==undefined&&source.length>maxEntries)
      throw Error('bridge_folder_plan_unverified');
  }else{
    onStage('scanning');
    source=await planBridgeFolder({root,listPage,signal,maxEntries,onScanProgress});
  }
  const totals=summarizeBridgeFolder(source);
  let started=false,done=false,completedFiles=0,keepStaging=false;
  try{
    cancelled(signal);
    onStage('destination');
    started=true;
    await begin();
    onStage('transfer');
    for(const item of source){
      cancelled(signal);
      if(item.directory)await makeDirectory(item.path);
      else{
        await downloadFile({
          handle:item.handle,path:item.path,size:item.size,mime:item.mime,signal
        });
        completedFiles++;
      }
    }
    cancelled(signal);
    onStage('finalizing');
    await commit({partial:false});
    done=true;
    return {entries:totals.entries,files:totals.files};
  }catch(error){
    const cancelledByUser=preserveCompletedOnCancel&&signal?.aborted&&
      error?.message==='bridge_transfer_cancelled';
    const interruptedByNetwork=preserveCompletedOnFailure&&!signal?.aborted&&
      transientReadErrors.has(error?.message);
    if(started&&completedFiles>0&&(cancelledByUser||interruptedByNetwork)){
      onStage('preserving');
      // The in-flight file writer discarded its unverified bytes before
      // throwing. Native SAF can publish only completed entries in a distinct
      // '(parziale)' folder. Never present this as a successful full download.
      keepStaging=true;
      const saved=await commit({partial:true,completedFiles});
      done=true;
      return {...totals,files:completedFiles,partial:true,
        interruptedBy:cancelledByUser?'user_cancel':'transient_read',
        savedName:saved?.name||null};
    }
    throw error;
  }finally{
    if(started&&!done&&!keepStaging)await discard();
  }
}
