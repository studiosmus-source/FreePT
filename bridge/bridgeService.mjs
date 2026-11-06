/**
 * Isolated in-process Bridge service boundary, NOT an HTTP server.
 *
 * authenticateAdmin must verify the request's Supabase JWT/identity using
 * a trusted server-side mechanism and return the approved admin's UUID.
 * Never supply this callback from a browser or trust a request-body receiverId.
 * Device registration/consent happens separately and is never automatic here.
 */
export class BridgeService {
  constructor({ registry, sessions, authenticateAdmin, authority = null }) {
    if (!registry || !sessions || typeof authenticateAdmin !== 'function')
      throw new Error('invalid_bridge_service_dependencies');
    this.registry = registry;
    this.sessions = sessions;
    if (authority !== null && typeof authority.assertAuthorized !== 'function' &&
        typeof authority.runAuthorized !== 'function')
      throw new Error('invalid_bridge_authority_dependency');
    this.authenticateAdmin = authenticateAdmin;
    this.authority = authority;
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
    // When supplied, runAuthorized must hold the same authoritative lock
    // over consent validation and mutation. This local Map is still not a
    // distributed transaction; persistent jobs must use the DB as well.
    if (this.authority?.runAuthorized)
      return this.authority.runAuthorized({deviceId,receiverId}, () => {
        this.registry.enqueue({jobId,deviceId,receiverId,operation:'list'});
        return {jobId,deviceId,state:'queued'};
      });
    if (this.authority)
      await this.authority.assertAuthorized({deviceId,receiverId});
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

  /**
   * Authenticate a previously enrolled TX and restore online presence.
   * The device's owner must have enabled Bridge first. Backend-only entrypoint.
   */
  connectDevice({ deviceId, deviceSecret }) {
    return this.sessions.connect({ deviceId, secret: deviceSecret });
  }

  pollDevice({ deviceId, sessionToken }) {
    // Validate BEFORE consuming queue; invalid TX never takes a job.
    const sessionBinding = this.sessions.getDispatchBinding({
      token: sessionToken, deviceId
    });
    if (!this.authority)
      return this.registry.takeNext(deviceId, sessionBinding);
    const pending = this.registry.peekNextReceiver(deviceId);
    if (!pending) return Promise.resolve(null);
    if (this.authority.runAuthorized)
      return this.authority.runAuthorized({
        deviceId,receiverId:pending.receiverId
      }, () => {
        const current=this.registry.peekNextReceiver(deviceId);
        if (!current || current.jobId !== pending.jobId ||
            current.receiverId !== pending.receiverId)
          throw new Error('bridge_authority_retry');
        this.sessions.assertDeviceSession({token:sessionToken,deviceId});
        return this.registry.takeNext(deviceId,sessionBinding);
      });
    return this.authority.assertAuthorized({
      deviceId, receiverId:pending.receiverId
    }).then(() => {
      // Another request may have changed the queue while the authority read
      // was pending. Never dispatch a different receiver under this approval.
      const current = this.registry.peekNextReceiver(deviceId);
      if (!current || current.jobId !== pending.jobId ||
          current.receiverId !== pending.receiverId)
        throw new Error('bridge_authority_retry');
      // TX session may also have been revoked while awaiting the shared read.
      this.sessions.assertDeviceSession({token:sessionToken,deviceId});
      return this.registry.takeNext(deviceId,sessionBinding);
    });
  }

  completeDevice({ deviceId, sessionToken, jobId }) {
    // TX can only complete a job already bound to this device. Receiver
    // identity is resolved from the server-owned job, never TX input.
    const sessionBinding = this.sessions.getDispatchBinding({
      token: sessionToken, deviceId
    });
    if (!this.authority)
      return this.registry.completeByDevice({jobId,deviceId,sessionBinding});
    const receiverId = this.registry.lookupDeviceJobReceiver({jobId,deviceId});
    if (this.authority.runAuthorized)
      return this.authority.runAuthorized({deviceId,receiverId}, () => {
        this.sessions.assertDeviceSession({token:sessionToken,deviceId});
        if (this.registry.lookupDeviceJobReceiver({jobId,deviceId}) !== receiverId)
          throw new Error('bridge_authority_retry');
        return this.registry.completeByDevice({jobId,deviceId,sessionBinding});
      });
    return this.authority.assertAuthorized({deviceId,receiverId}).then(() => {
      this.sessions.assertDeviceSession({token:sessionToken,deviceId});
      if (this.registry.lookupDeviceJobReceiver({jobId,deviceId}) !== receiverId)
        throw new Error('bridge_authority_retry');
      return this.registry.completeByDevice({jobId,deviceId,sessionBinding});
    });
  }
}
