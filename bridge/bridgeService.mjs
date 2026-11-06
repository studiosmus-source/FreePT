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

  async requestList({ authContext, deviceId, jobId }) {
    // Identity comes exclusively from a trusted server authenticator.
    const admin = await this.authenticateAdmin(authContext);
    if (!admin || admin.role !== 'admin' || admin.approved !== true ||
        typeof admin.id !== 'string' || !admin.id)
      throw new Error('bridge_admin_required');
    // Strictly limit first prototype to folder listing requests; no arbitrary
    // file paths or direct remote file reads until Android scoped-share exists.
    this.registry.enqueue({
      jobId, deviceId, receiverId: admin.id, operation: 'list'
    });
    return { jobId, deviceId, state: 'queued' };
  }

  pollDevice({ deviceId, sessionToken }) {
    // Validate BEFORE consuming queue; invalid TX never takes a job.
    this.sessions.assertDeviceSession({ token: sessionToken, deviceId });
    const job = this.registry.takeNext(deviceId);
    if (!job) return null;
    this.sessions.authorize({
      token: sessionToken, deviceId, receiverId: job.receiverId
    });
    return job;
  }

  completeDevice({ deviceId, sessionToken, jobId }) {
    // TX can only complete a job already bound to this device. Receiver
    // identity is resolved from the server-owned job, never TX input.
    this.sessions.assertDeviceSession({ token: sessionToken, deviceId });
    return this.registry.completeByDevice({ jobId, deviceId });
  }
}
