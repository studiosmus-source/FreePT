/**
 * Staging TX folder-list transport. Explicitly opt-in and device-provisioned.
 * No auto-start, background service, credential persistence or prod fallback.
 * Server revalidates ownership/grants/session on dispatch and completion.
 */
import {validateBridgeFolderPage,validateBridgeJobIdentity,validateBridgeReadRequest,validateBridgeFileChunk} from './bridgeFileProtocol.js';
import {normalizeBridgeApiUrl} from './bridgeAdminClient.js';
import {bridgePollRetry} from './bridgePollRetry.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX=/^[0-9a-f]{64}$/;
const SHAPES=new Set(['connect','poll','folder','chunk','browse','disconnect']);
export function createBridgeFolderTransmitter({
  baseUrl,deviceId,deviceSecret,folderProvider,fetchImpl=fetch
}={}){
  const url=normalizeBridgeApiUrl(baseUrl);
  if(!url||!UUID.test(deviceId)||!HEX.test(deviceSecret)||
     typeof folderProvider?.list!=='function'||typeof fetchImpl!=='function')
    throw Error('bridge_tx_not_provisioned');
  let session=null;
  let closed=false;
  async function request(action,body){
    if(!SHAPES.has(action)||closed)throw Error('bridge_tx_disabled');
    let response;
    try{
      const send=()=>fetchImpl(url+'/bridge/tx/'+action,{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({deviceId,...body}),
        cache:'no-store',redirect:'error'
      });
      // Only confirmed gateway throttling (429) can be retried.
      // Poll may already have claimed a job after any ambiguous failure.
      response=action==='poll'?await bridgePollRetry(send):await send();
    }catch{throw Error('bridge_tx_network_unavailable');}
    if(!response?.ok)throw Error('bridge_tx_request_denied');
    try{return await response.json();}
    catch{throw Error('bridge_tx_invalid_response');}
  }
  return Object.freeze({
    async connect(){
      if(session)throw Error('bridge_tx_already_connected');
      const result=await request('connect',{deviceSecret});
      if(typeof result?.token!=='string'||!HEX.test(result.token)||
         typeof result.expiresAt!=='string'&&
         !Number.isFinite(result?.expiresAt))throw Error('bridge_tx_invalid_response');
      session=result.token;
      return true;
    },
    async processOne(){
      if(!session||closed)throw Error('bridge_tx_not_connected');
      const job=await request('poll',{sessionToken:session});
      if(job?.job===null)return false;
      const item=job?.job;
      if(!item||!['list','read','browse'].includes(item.operation)||item.state!=='sent')
        throw Error('bridge_tx_invalid_job');
      validateBridgeJobIdentity({jobId:item.jobId,deviceId:item.deviceId});
      if(item.deviceId!==deviceId)throw Error('bridge_tx_wrong_device');
      if(item.operation==='read'){
        if(typeof folderProvider.readChunk!=='function')
          throw Error('bridge_tx_read_unavailable');
        const requestData=validateBridgeReadRequest({
          handle:item.handle,offset:item.offset,length:item.length
        });
        if(requestData.length>32768)throw Error('bridge_tx_chunk_too_large');
        const chunk=validateBridgeFileChunk(
          await folderProvider.readChunk(requestData),requestData.length
        );
        if(chunk.bytesRead!==requestData.length)
          throw Error('bridge_tx_chunk_truncated');
        const finished=await request('chunk',{
          sessionToken:session,jobId:item.jobId,chunk
        });
        if(finished?.jobId!==item.jobId||finished?.deviceId!==deviceId||
           finished?.state!=='done')throw Error('bridge_tx_invalid_response');
        return true;
      }
      if(item.operation==='browse'){
        const handle=item.handle;
        if(!(handle==='root'||UUID.test(handle))||
           !Number.isSafeInteger(item.offset)||item.offset<0||item.offset>10000)
          throw Error('bridge_tx_invalid_job');
        const page=validateBridgeFolderPage(
          await folderProvider.list({handle,offset:item.offset})
        );
        const finished=await request('browse',{
          sessionToken:session,jobId:item.jobId,
          entries:page.entries,nextOffset:page.nextOffset
        });
        if(finished?.jobId!==item.jobId||finished?.deviceId!==deviceId||
           finished?.state!=='done')throw Error('bridge_tx_invalid_response');
        return true;
      }
      // Only the explicitly selected local root; no supplied paths or handles.
      const page=validateBridgeFolderPage(
        await folderProvider.list({handle:'root',offset:0})
      );
      if(page.nextOffset!==-1)
        throw Error('bridge_tx_folder_too_large');
      const finished=await request('folder',{
        sessionToken:session,jobId:item.jobId,entries:page.entries
      });
      if(finished?.jobId!==item.jobId||finished?.deviceId!==deviceId||
         finished?.state!=='done')throw Error('bridge_tx_invalid_response');
      return true;
    },
    async disconnect(){
      if(closed)return false;
      const token=session;
      closed=true;session=null;
      if(!token)return false;
      try{
        const reply=await fetchImpl(url+'/bridge/tx/disconnect',{
          method:'POST',headers:{'content-type':'application/json'},
          body:JSON.stringify({deviceId,sessionToken:token}),
          cache:'no-store',redirect:'error'
        });
        return reply?.ok===true;
      }catch{return false;}
    }
  });
}
