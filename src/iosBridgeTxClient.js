/**
 * iOS foreground-only TX adapter for the existing Bridge wire protocol.
 * Device secrets/session tokens live exclusively in the native Keychain plugin.
 * Never expose a remote request except for a job accepted by that plugin.
 */
import {
  validateBridgeFolderPage,validateBridgeReadRequest,validateBridgeFileChunk
} from './bridgeFileProtocol.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createIOSBridgeTxClient({files,device}={}){
  if(!files||!device||
     ['list','read'].some(k=>typeof files[k]!=='function')||
     ['connect','poll','respond','disconnect'].some(k=>typeof device[k]!=='function'))
    throw Error('ios_bridge_native_unavailable');
  let connected=false,active=false;
  let busy=false;
  async function step(){
    if(!active||busy)return false;
    busy=true;
    try{
      if(!connected){
        const result=await device.connect();
        if(result?.connected!==true)throw Error('ios_bridge_connection_failed');
        connected=true;
      }
      const response=await device.poll();
      if(!active)return false;
      const job=response?.job;
      if(job==null)return false;
      if(!UUID.test(job.jobId)||!UUID.test(job.deviceId)||
         job.state!=='sent'||!['list','browse','read'].includes(job.operation))
        throw Error('ios_bridge_invalid_job');
      if(job.operation==='list'){
        const page=validateBridgeFolderPage(await files.list({handle:'root',offset:0}));
        if(page.nextOffset!==-1)throw Error('ios_bridge_root_too_large');
        await device.respond({jobId:job.jobId,entries:page.entries});
      }else if(job.operation==='browse'){
        if(typeof job.handle!=='string'||!Number.isSafeInteger(job.offset)||
           job.offset<0||job.offset>10000)throw Error('ios_bridge_invalid_browse');
        const page=validateBridgeFolderPage(await files.list({handle:job.handle,offset:job.offset}));
        await device.respond({jobId:job.jobId,entries:page.entries,nextOffset:page.nextOffset});
      }else{
        const request=validateBridgeReadRequest({
          handle:job.handle,offset:job.offset,length:job.length
        });
        const chunk=validateBridgeFileChunk(await files.read(request),request.length);
        await device.respond({jobId:job.jobId,chunk});
      }
      return true;
    }catch{
      // Reconnect after invalid/expired sessions; native plugin validates each
      // response against the pending authenticated job before acknowledging.
      connected=false;
      try{await device.disconnect();}catch{}
      return false;
    }finally{busy=false;}
  }
  return Object.freeze({
    start(){active=true;},
    async stop(){
      active=false;
      if(!busy){connected=false;await device.disconnect();}
    },
    step,
    status(){return {active,connected,busy};}
  });
}
