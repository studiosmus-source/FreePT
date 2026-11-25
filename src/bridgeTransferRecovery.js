// Only transport/liveness failures are recoverable. Never retry validation,
// authentication, permissions, unsafe metadata or local storage errors.
const transient=new Set([
  'bridge_network_unavailable','bridge_backend_unavailable',
  'bridge_request_throttled','bridge_http_timeout',
  'bridge_download_timeout','bridge_download_job_expired',
  'bridge_download_job_cancelled','bridge_remote_browse_timeout',
  'bridge_remote_browse_expired'
]);
export const isBridgeTransferInterruption=error=>transient.has(error?.message);
export function checkBridgeAbort(signal){
  if(signal?.aborted)throw Error('bridge_transfer_cancelled');
}
export async function retryBridgeRead(run,{signal,pause,pollMs=700}){
  // Read-only retrieval of an EXISTING job. Never use for enqueue operations.
  for(let attempt=0;attempt<3;attempt++){
    checkBridgeAbort(signal);
    try{return await run();}
    catch(error){
      if(!['bridge_network_unavailable','bridge_backend_unavailable',
        'bridge_request_throttled','bridge_http_timeout'].includes(error?.message)||attempt===2)
        throw error;
      await pause(Math.max(700,pollMs)*(attempt+1));
    }
  }
}
