/**
 * Transactional download of one selected Bridge folder and all descendants.
 * The caller must supply a backend-authenticated listPage that is scoped to
 * the owner's selected SAF tree, plus an Android SAF staging destination.
 * This module does not infer paths from URIs or access unrestricted storage.
 */
import {receiveBridgeFolder} from '../bridge/folderReceiver.mjs';
import {downloadBridgeFile} from './bridgeDownloadClient.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * destination contract:
 * begin(), makeDirectory(relativeSegments), openFile(relativeSegments) =>
 * {write(bytes,offset),commit(),discard()}, commit(), discard().
 * The root directory is staged until the final successful commit.
 */
export async function downloadBridgeFolder({
  api,deviceId,root='root',listPage,destination,signal,
  pause,pollMs,maxPolls,maxEntries,onProgress=()=>{}
}={}){
  if(!UUID.test(deviceId)||!api||typeof listPage!=='function'||
     !destination||['begin','makeDirectory','openFile','commit','discard']
       .some(method=>typeof destination[method]!=='function')||
     typeof onProgress!=='function')
    throw Error('bridge_folder_download_invalid_options');

  let completedFiles=0;
  const downloadFile=async({handle,path,size,mime,signal:currentSignal})=>{
    const writer=await destination.openFile(path,{size,mime});
    if(!writer||['write','commit','discard'].some(k=>typeof writer[k]!=='function'))
      throw Error('bridge_folder_file_writer_invalid');
    await downloadBridgeFile({
      api,deviceId,handle,size,destination:writer,signal:currentSignal,
      ...(pause===undefined?{}:{pause}),
      ...(pollMs===undefined?{}:{pollMs}),
      ...(maxPolls===undefined?{}:{maxPolls}),
      onProgress:progress=>onProgress({
        path:[...path],completedFiles,fileBytes:progress.receivedBytes,
        fileTotalBytes:progress.totalBytes
      })
    });
    completedFiles++;
    onProgress({path:[...path],completedFiles,fileBytes:size,fileTotalBytes:size});
  };

  return receiveBridgeFolder({
    root,listPage,signal,
    ...(maxEntries===undefined?{}:{maxEntries}),
    begin:()=>destination.begin(),
    makeDirectory:path=>destination.makeDirectory(path),
    downloadFile,
    commit:()=>destination.commit(),
    discard:()=>destination.discard()
  });
}
