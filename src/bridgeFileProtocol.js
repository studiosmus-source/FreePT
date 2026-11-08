/**
 * Bridge file catalogue/transfer wire contract, staging-only.
 * Metadata and chunks originate only from an explicitly owner-selected SAF tree.
 * Validation does NOT confer authorization: backend must bind every request,
 * response and chunk to a live TX session, a job, a device and an approved grant.
 */
export const BRIDGE_FILE_LIMITS = Object.freeze({
  pageSize: 100,
  maxDepth: 16,
  maxName: 255,
  maxMime: 160,
  maxFileBytes: 1024 ** 4,
  maxChunkBytes: 262144,
  maxTotalEntries: 10000
});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HANDLE=/^(?:root|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const own=(v,k)=>Object.prototype.hasOwnProperty.call(v,k);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,keys)=>object(v)&&Object.keys(v).length===keys.length&&keys.every(k=>own(v,k));
const safeInteger=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
function entry(v){
  if(!exact(v,['handle','name','directory','size','mime']))throw Error('bridge_file_metadata_invalid');
  if(!HANDLE.test(v.handle) || v.handle==='root' ||
      typeof v.name!=='string'||v.name.length<1||v.name.length>BRIDGE_FILE_LIMITS.maxName||
      /[\\/\u0000-\u001f\u007f]/u.test(v.name)||v.name==='.'||v.name==='..'||
      typeof v.directory!=='boolean'||typeof v.mime!=='string'||
      v.mime.length>BRIDGE_FILE_LIMITS.maxMime||
      !safeInteger(v.size,-1,BRIDGE_FILE_LIMITS.maxFileBytes))
    throw Error('bridge_file_metadata_invalid');
  return Object.freeze({...v});
}
export function validateBridgeFolderPage(payload){
  if(!exact(payload,['entries','nextOffset'])||!Array.isArray(payload.entries)||
      payload.entries.length>BRIDGE_FILE_LIMITS.pageSize||
      !safeInteger(payload.nextOffset,-1,BRIDGE_FILE_LIMITS.maxTotalEntries))
    throw Error('bridge_file_page_invalid');
  const found=new Set();
  const entries=payload.entries.map(item=>{
    const valid=entry(item);
    if(found.has(valid.handle))throw Error('bridge_file_page_invalid');
    found.add(valid.handle);
    return valid;
  });
  if(payload.nextOffset!==-1&&entries.length!==BRIDGE_FILE_LIMITS.pageSize)
    throw Error('bridge_file_page_invalid');
  return Object.freeze({entries:Object.freeze(entries),nextOffset:payload.nextOffset});
}
export function validateBridgeReadRequest(request){
  if(!exact(request,['handle','offset','length'])||
      !HANDLE.test(request.handle)||request.handle==='root'||
      !safeInteger(request.offset,0,BRIDGE_FILE_LIMITS.maxFileBytes)||
      !safeInteger(request.length,1,BRIDGE_FILE_LIMITS.maxChunkBytes)||
      request.offset+request.length>BRIDGE_FILE_LIMITS.maxFileBytes)
    throw Error('bridge_file_read_invalid');
  return Object.freeze({...request});
}
export function validateBridgeFileChunk(chunk, requestedLength){
  if(!safeInteger(requestedLength,1,BRIDGE_FILE_LIMITS.maxChunkBytes)||
      !exact(chunk,['base64','bytesRead','eof'])||
      typeof chunk.base64!=='string'||typeof chunk.eof!=='boolean'||
      !safeInteger(chunk.bytesRead,0,requestedLength))
    throw Error('bridge_file_chunk_invalid');
  // Enforce canonical, unpadded Base64 equivalence without Buffer for Android WebView.
  if(chunk.base64.length!==Math.ceil(chunk.bytesRead/3)*4||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(chunk.base64))
    throw Error('bridge_file_chunk_invalid');
  if(!chunk.eof && chunk.bytesRead!==requestedLength)
    throw Error('bridge_file_chunk_invalid');
  return Object.freeze({...chunk});
}
export function validateBridgeJobIdentity({jobId,deviceId}){
  if(!UUID.test(jobId)||!UUID.test(deviceId))
    throw Error('bridge_file_identity_invalid');
  return Object.freeze({jobId,deviceId});
}
