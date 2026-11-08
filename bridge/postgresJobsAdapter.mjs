import {validateBridgeFolderPage,validateBridgeReadRequest,validateBridgeFileChunk} from '../src/bridgeFileProtocol.js';
/**
 * Backend-only adapter for staging PostgreSQL job RPCs.
 * Caller MUST supply a server-owned service-role RPC client. Never import
 * this module in FreePT browser/Android code or expose RPC credentials.
 *
 * This intentionally does not use BridgeRegistry's in-memory job queue.
 * Admin identity must be established via trusted authenticateAdmin; TX must
 * pass BridgeDeviceSessionGate before any database call. No device enrollment,
 * file read, transfer, or production server is implemented here.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BINDING = /^[0-9a-f]{64}$/;
const requireId = value => {
  if (typeof value !== 'string' || !UUID.test(value))
    throw new Error('bridge_invalid_identity');
};
export class BridgePostgresJobsAdapter {
  constructor({ rpcClient, sessions, authenticateAdmin }) {
    if (typeof rpcClient?.rpc !== 'function' ||
        typeof sessions?.getDispatchBinding !== 'function' ||
        typeof authenticateAdmin !== 'function')
      throw new Error('invalid_postgres_jobs_dependencies');
    this.rpcClient = rpcClient;
    this.sessions = sessions;
    this.authenticateAdmin = authenticateAdmin;
  }

  async #rpc(name, args) {
    let result;
    try {
      result = await this.rpcClient.rpc(name, args);
    } catch {
      throw new Error('bridge_jobs_database_unavailable');
    }
    if (!result || result.error) throw new Error('bridge_jobs_database_unavailable');
    return result.data;
  }

  async requestList({authContext,deviceId,jobId}) {
    requireId(deviceId);
    requireId(jobId);
    const receiverId = await this.#requireAdminId(authContext);
    const data=await this.#rpc('bridge_server_enqueue_list',{
      p_job_id:jobId,p_device_id:deviceId,p_receiver_id:receiverId
    });
    if (data !== jobId) throw new Error('bridge_jobs_invalid_response');
    return {jobId,deviceId,state:'queued'};
  }

  async requestRead({authContext,deviceId,jobId,handle,offset,length}) {
    requireId(deviceId);requireId(jobId);
    const request=validateBridgeReadRequest({handle,offset,length});
    if(length>32768)throw Error('bridge_read_chunk_limit');
    const receiverId=await this.#requireAdminId(authContext);
    const data=await this.#rpc('bridge_server_enqueue_read',{
      p_job_id:jobId,p_device_id:deviceId,p_receiver_id:receiverId,
      p_handle:request.handle,p_offset:request.offset,p_length:request.length
    });
    if(data!==jobId)throw Error('bridge_jobs_invalid_response');
    return {jobId,deviceId,state:'queued'};
  }

  async #requireAdminId(authContext) {
    const admin = await this.authenticateAdmin(authContext);
    if (!admin || admin.role !== 'admin' || admin.approved !== true)
      throw new Error('bridge_admin_required');
    requireId(admin.id);
    return admin.id;
  }

  async getRequestStatus({authContext,jobId}) {
    requireId(jobId);
    const receiverId = await this.#requireAdminId(authContext);
    const data=await this.#rpc('bridge_server_job_status',{
      p_job_id:jobId,p_receiver_id:receiverId
    });
    return this.#validateJobResult(data,jobId);
  }

  async cancelRequest({authContext,jobId}) {
    requireId(jobId);
    const receiverId = await this.#requireAdminId(authContext);
    const data=await this.#rpc('bridge_server_cancel_job',{
      p_job_id:jobId,p_receiver_id:receiverId
    });
    return this.#validateJobResult(data,jobId,'cancelled');
  }

  #validateJobResult(data,jobId,requiredState=null) {
    if (!data || typeof data!=='object' || Array.isArray(data) ||
        Object.keys(data).length!==3 ||
        data.jobId!==jobId || typeof data.deviceId!=='string' ||
        !UUID.test(data.deviceId) ||
        !['queued','sent','done','cancelled'].includes(data.state) ||
        (requiredState!==null && data.state!==requiredState))
      throw new Error('bridge_jobs_invalid_response');
    return {jobId:data.jobId,deviceId:data.deviceId,state:data.state};
  }

  async pollDevice({deviceId,sessionToken}) {
    requireId(deviceId);
    const binding=await this.sessions.getDispatchBinding({deviceId,token:sessionToken});
    if (!BINDING.test(binding)) throw new Error('bridge_invalid_session_binding');
    const next=await this.#rpc('bridge_server_claim_read',{
      p_device_id:deviceId,p_session_binding_hex:binding
    });
    if(next!==null){
      if(!next||typeof next!=='object'||Array.isArray(next)||
         Object.keys(next).sort().join(',')!=='deviceId,handle,jobId,length,offset,operation,state'||
         !UUID.test(next.jobId)||next.deviceId!==deviceId||
         next.operation!=='read'||next.state!=='sent')
        throw Error('bridge_jobs_invalid_response');
      validateBridgeReadRequest({handle:next.handle,offset:next.offset,length:next.length});
      if(next.length>32768)throw Error('bridge_jobs_invalid_response');
      return next;
    }
    const data=await this.#rpc('bridge_server_claim_list',{
      p_device_id:deviceId,p_session_binding_hex:binding
    });
    if (data === null) return null;
    if (typeof data !== 'string' || !UUID.test(data))
      throw new Error('bridge_jobs_invalid_response');
    return {jobId:data,deviceId,operation:'list',state:'sent'};
  }

  /**
   * Store a bounded root-directory catalogue after authenticated TX possession.
   * PostgreSQL rechecks grant, session and job while holding the device lock.
   */
  async completeFolderPage({deviceId,sessionToken,jobId,entries}) {
    requireId(deviceId);
    requireId(jobId);
    const validated=validateBridgeFolderPage({entries,nextOffset:-1});
    const binding=await this.sessions.getDispatchBinding({deviceId,token:sessionToken});
    if(!BINDING.test(binding))throw Error('bridge_invalid_session_binding');
    const result=await this.#rpc('bridge_server_complete_folder_page',{
      p_job_id:jobId,p_device_id:deviceId,p_session_binding_hex:binding,
      p_entries:validated.entries
    });
    if(result!==true)throw Error('bridge_jobs_invalid_response');
    return {jobId,deviceId,state:'done'};
  }

  async completeRead({deviceId,sessionToken,jobId,chunk}){
    requireId(deviceId);requireId(jobId);
    const validated=validateBridgeFileChunk(chunk,32768);
    if(validated.bytesRead>32768)throw Error('bridge_read_chunk_limit');
    const binding=await this.sessions.getDispatchBinding({deviceId,token:sessionToken});
    if(!BINDING.test(binding))throw Error('bridge_invalid_session_binding');
    const result=await this.#rpc('bridge_server_complete_read',{
      p_job_id:jobId,p_device_id:deviceId,p_session_binding_hex:binding,p_chunk:validated
    });
    if(result!==true)throw Error('bridge_jobs_invalid_response');
    return {jobId,deviceId,state:'done'};
  }

  async getReadChunk({authContext,jobId}){
    requireId(jobId);
    const receiverId=await this.#requireAdminId(authContext);
    const result=await this.#rpc('bridge_server_read_chunk',{
      p_job_id:jobId,p_receiver_id:receiverId
    });
    return validateBridgeFileChunk(result,32768);
  }

  /** Read only the calling, verified admin's explicitly granted result. */
  async getFolderPage({authContext,jobId}) {
    requireId(jobId);
    const receiverId=await this.#requireAdminId(authContext);
    const result=await this.#rpc('bridge_server_read_folder_page',{
      p_job_id:jobId,p_receiver_id:receiverId
    });
    const validated=validateBridgeFolderPage({entries:result,nextOffset:-1});
    return {jobId,entries:validated.entries,nextOffset:-1};
  }

  async completeDevice({deviceId,sessionToken,jobId}) {
    requireId(deviceId);
    requireId(jobId);
    const binding=await this.sessions.getDispatchBinding({deviceId,token:sessionToken});
    if (!BINDING.test(binding)) throw new Error('bridge_invalid_session_binding');
    const result=await this.#rpc('bridge_server_complete_list',{
      p_job_id:jobId,p_device_id:deviceId,p_session_binding_hex:binding
    });
    if (result !== true) throw new Error('bridge_jobs_invalid_response');
    return {jobId,deviceId,state:'done'};
  }
}
