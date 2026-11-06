/**
 * Isolated in-process Bridge service boundary, NOT an HTTP server.
 *
 * authenticateAdmin must verify the request's Supabase JWT/identity using
 * a trusted server-side mechanism and return the approved admin's UUID.
 * Never supply this callback from a browser or trust a request-body receiverId.
 * Device registration/consent happens separately and is never automatic here.
 */
export class BridgeService {
  constructor({ registry, sessions, authenticateAdmin }) {
    if (!registry || !sessions || typeof authenticateAdmin !== 'function')
      throw new Error('invalid_bridge_service_dependencies');
    this.registry = registry;
    this.sessions = sessions;
    this.authenticateAdmin = authenticateAdmin;
  }

  async #requireAdmin(authContext) {
    // The callback must validate caller identity server-side, not trust body fields.
    const admin = await this.authenticateAdmin(authContext);
    if (!admin || admin.role !== 'admin' || admin.approved !== true ||
        typeof admin.id !== 'string' || !admin.id)
      throw new Error('bridge_admin_required');
    return admin.id;
  }

  async requestList({ authContext, deviceId, jobId }) {
    const receiverId = await this.#requireAdmin(authContext);
    // Only folder-listing jobs; no arbitrary remote file or shell operations.
    this.registry.enqueue({ jobId, deviceId, receiverId, operation: 'list' });
    return { jobId, deviceId, state: 'queued' };
  }

  async cancelRequest({ authContext, jobId }) {
    const receiverId = await this.#requireAdmin(authContext);
    return this.registry.cancelJob({ jobId, receiverId });
  }

  async getRequestStatus({ authContext, jobId }) {
    const receiverId = await this.#requireAdmin(authContext);
    return this.registry.getJobStatus({ jobId, receiverId });
  }

  pollDevice({ deviceId, sessionToken }) {
    // Validate BEFORE consuming queue; invalid TX never takes a job.
    const sessionBinding = this.sessions.getDispatchBinding({
      token: sessionToken, deviceId
    });
    return this.registry.takeNext(deviceId, sessionBinding);
  }

  completeDevice({ deviceId, sessionToken, jobId }) {
    // TX can only complete a job already bound to this device. Receiver
    // identity is resolved from the server-owned job, never TX input.
    const sessionBinding = this.sessions.getDispatchBinding({
      token: sessionToken, deviceId
    });
    return this.registry.completeByDevice({ jobId, deviceId, sessionBinding });
  }
}
