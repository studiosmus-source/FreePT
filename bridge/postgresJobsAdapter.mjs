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
    const data=await this.#rpc('bridge_server_claim_list',{
      p_device_id:deviceId,p_session_binding_hex:binding
    });
    if (data === null) return null;
    if (typeof data !== 'string' || !UUID.test(data))
      throw new Error('bridge_jobs_invalid_response');
    return {jobId:data,deviceId,operation:'list',state:'sent'};
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
