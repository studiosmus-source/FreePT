/**
 * Pure Bridge routing model. NO network, file access, persistence or Android hooks.
 * A production backend must authenticate callers, validate tokens and persist grants.
 */
export class BridgeRegistry {
  #devices = new Map();
  #grants = new Map();
  #jobs = new Map();

  constructor({ now = () => Date.now(), maxJobs = 100, jobLifetimeMs = 60_000 } = {}) {
    if (typeof now !== 'function' || !Number.isSafeInteger(maxJobs) || maxJobs < 1 ||
        !Number.isSafeInteger(jobLifetimeMs) || jobLifetimeMs < 1)
      throw new Error('invalid_job_limits');
    this.now = now;
    this.maxJobs = maxJobs;
    this.jobLifetimeMs = jobLifetimeMs;
  }

  #isExpired(job) {
    return this.now() >= job.createdAt + this.jobLifetimeMs;
  }

  #pruneJobs() {
    for (const [id, job] of this.#jobs) {
      if (this.#isExpired(job)) this.#jobs.delete(id);
    }
  }

  // Collision-free key: user-controlled IDs may contain punctuation.
  #grantKey(deviceId, receiverId) {
    return JSON.stringify([deviceId, receiverId]);
  }

  /**
   * Durable state for a trusted server-side store.
   * Online presence and queued/sent jobs are deliberately not persisted:
   * after restart, every device must reconnect and authenticate again.
   * NEVER hydrate directly from a client-provided snapshot.
   */
  snapshot() {
    return {
      version: 1,
      devices: [...this.#devices.values()].map(({ id, ownerId, label, bridgeEnabled }) => ({
        id, ownerId, label, bridgeEnabled
      })),
      grants: [...this.#grants.values()]
        .filter(grant => grant.active)
        .map(({ deviceId, receiverId }) => ({ deviceId, receiverId }))
    };
  }

  static fromTrustedSnapshot(snapshot) {
    if (!snapshot || snapshot.version !== 1 ||
        !Array.isArray(snapshot.devices) || !Array.isArray(snapshot.grants))
      throw new Error('invalid_snapshot');

    const registry = new BridgeRegistry();
    for (const device of snapshot.devices) {
      registry.registerDevice(device);
      if (device.bridgeEnabled === true) {
        registry.setBridgeEnabled({ deviceId: device.id, ownerId: device.ownerId, enabled: true });
      } else if (device.bridgeEnabled !== false && device.bridgeEnabled !== undefined) {
        throw new Error('invalid_snapshot');
      }
    }
    for (const grant of snapshot.grants) {
      const device = registry.#devices.get(grant.deviceId);
      if (!device || !grant.receiverId || typeof grant.receiverId !== 'string')
        throw new Error('invalid_snapshot');
      registry.grant({
        deviceId: grant.deviceId,
        receiverId: grant.receiverId,
        approvedByOwnerId: device.ownerId
      });
    }
    return registry;
  }

  registerDevice({ id, ownerId, label }) {
    if (!id || !ownerId || !label || typeof id !== 'string' ||
        typeof ownerId !== 'string' || typeof label !== 'string')
      throw new Error('invalid_device');
    if (this.#devices.has(id)) throw new Error('device_already_registered');
    this.#devices.set(id, { id, ownerId, label, online: false, bridgeEnabled: false, sessionEpoch: 0 });
  }

  setOnline(deviceId, online) {
    const device = this.#devices.get(deviceId);
    if (!device) throw new Error('unknown_device');
    // A heartbeat cannot override the owner's explicit shutdown.
    const nextOnline = online === true && device.bridgeEnabled;
    if (device.online && !nextOnline) {
      // Dispatched jobs cannot be accepted after transport interruption.
      // Queued work stays pending until its deadline, but the TX must
      // reconnect and establish a fresh authenticated session.
      device.sessionEpoch += 1;
      for (const job of this.#jobs.values()) {
        if (job.deviceId === deviceId && job.state === 'sent')
          job.state = 'cancelled';
      }
    }
    device.online = nextOnline;
  }

  /** Owner-initiated Bridge switch: not inferred from a dropped connection. */
  setBridgeEnabled({ deviceId, ownerId, enabled }) {
    const device = this.#devices.get(deviceId);
    if (!device || device.ownerId !== ownerId) throw new Error('owner_required');
    if (typeof enabled !== 'boolean') throw new Error('invalid_bridge_state');
    device.bridgeEnabled = enabled;
    if (!enabled) {
      // Any existing authenticated TX session must be renewed after an off/on cycle.
      device.sessionEpoch += 1;
      device.online = false;
      for (const [id, job] of this.#jobs) {
        if (job.deviceId === deviceId) this.#jobs.delete(id);
      }
    }
  }

  /** Backend-only owner switch check used before authenticated TX connection. */
  isDeviceEnabled(deviceId) {
    return this.#devices.get(deviceId)?.bridgeEnabled === true;
  }

  /** Internal transport gate; not a substitute for server caller authentication. */
  isDeviceReady(deviceId) {
    const device = this.#devices.get(deviceId);
    return !!(device?.online && device.bridgeEnabled);
  }

  /**
   * Backend-only session generation: invalidates old sessions after explicit
   * owner shutdown, even if Bridge is later re-enabled.
   * Never expose this as a client authorization decision by itself.
   */
  getSessionEpoch(deviceId) {
    const device = this.#devices.get(deviceId);
    if (!device) throw new Error('unknown_device');
    return device.sessionEpoch;
  }

  /** Receiver-scoped device state: intentionally closed is not a network outage. */
  getDeviceStatus({ deviceId, receiverId }) {
    const device = this.#devices.get(deviceId);
    if (!device || !this.#grants.get(this.#grantKey(deviceId, receiverId))?.active)
      throw new Error('bridge_not_authorized');
    return {
      deviceId: device.id,
      label: device.label,
      state: !device.bridgeEnabled ? 'closed_by_owner' :
        device.online ? 'online' : 'offline'
    };
  }

  /** Called only after a backend-validated, explicit owner approval. */
  grant({ deviceId, receiverId, approvedByOwnerId }) {
    const device = this.#devices.get(deviceId);
    if (!device) throw new Error('unknown_device');
    if (device.ownerId !== approvedByOwnerId || !receiverId)
      throw new Error('approval_required');
    this.#grants.set(this.#grantKey(deviceId, receiverId), { deviceId, receiverId, active: true });
  }

  revoke({ deviceId, receiverId, approvedByOwnerId }) {
    const device = this.#devices.get(deviceId);
    if (!device || device.ownerId !== approvedByOwnerId) throw new Error('owner_required');
    const grant = this.#grants.get(this.#grantKey(deviceId, receiverId));
    if (grant?.active) {
      grant.active = false;
      // A subsequent grant must not revive any session opened before this
      // revocation. Conservative per-device invalidation also affects other
      // receivers: they must authenticate a fresh TX session.
      device.sessionEpoch += 1;
    }
    for (const [id, job] of this.#jobs) {
      if (job.deviceId === deviceId && job.receiverId === receiverId) this.#jobs.delete(id);
    }
  }

  listApproved(receiverId) {
    return [...this.#devices.values()]
      .filter(device => this.#grants.get(this.#grantKey(device.id, receiverId))?.active)
      .map(device => ({ ...device }));
  }

  /** No implicit default TX. Job is bound to exactly one device and receiver. */
  enqueue({ jobId, deviceId, receiverId, operation }) {
    if (typeof jobId !== 'string' || !jobId || jobId.length > 128 ||
        typeof deviceId !== 'string' || !deviceId ||
        typeof receiverId !== 'string' || !receiverId || operation !== 'list')
      throw new Error('invalid_job');
    this.#pruneJobs();
    if (this.#jobs.has(jobId)) throw new Error('duplicate_job');
    if ([...this.#jobs.values()].filter(job => job.state === 'queued' || job.state === 'sent').length >= this.maxJobs)
      throw new Error('job_queue_full');
    const device = this.#devices.get(deviceId);
    if (!device?.online || !device.bridgeEnabled) throw new Error('device_offline');
    if (!this.#grants.get(this.#grantKey(deviceId, receiverId))?.active) throw new Error('bridge_not_authorized');
    this.#jobs.set(jobId, {
      jobId, deviceId, receiverId, operation, state: 'queued', createdAt: this.now()
    });
  }

  /** Called after the backend verifies the admin; never trust receiverId from TX. */
  cancelJob({ jobId, receiverId }) {
    this.#pruneJobs();
    const job = this.#jobs.get(jobId);
    if (!job || job.receiverId !== receiverId) throw new Error('job_not_authorized');
    if (job.state === 'done' || job.state === 'cancelled')
      throw new Error('job_already_final');
    job.state = 'cancelled';
    return { jobId, deviceId: job.deviceId, state: 'cancelled' };
  }

  /** Owner/admin-facing status, only after verified authorization at the API boundary. */
  getJobStatus({ jobId, receiverId }) {
    this.#pruneJobs();
    const job = this.#jobs.get(jobId);
    if (!job || job.receiverId !== receiverId) throw new Error('job_not_authorized');
    return { jobId, deviceId: job.deviceId, state: job.state };
  }

  /**
   * Backend-only identity lookup for the next pending TX job. A caller must
   * authenticate the TX and verify authoritative consent before dispatching.
   * Never expose this method directly as an HTTP route.
   */
  peekNextReceiver(deviceId) {
    this.#pruneJobs();
    if (!this.#devices.get(deviceId)?.online ||
        !this.#devices.get(deviceId)?.bridgeEnabled) return null;
    const job = [...this.#jobs.values()].find(item =>
      item.deviceId === deviceId && item.state === 'queued');
    return job ? {jobId:job.jobId, receiverId:job.receiverId} : null;
  }

  /** Backend-only receiver lookup for authenticated completion. */
  lookupDeviceJobReceiver({jobId, deviceId}) {
    this.#pruneJobs();
    const job = this.#jobs.get(jobId);
    if (!job || job.deviceId !== deviceId || job.state !== 'sent')
      throw new Error('job_not_authorized');
    return job.receiverId;
  }

  takeNext(deviceId, sessionBinding = null) {
    if (sessionBinding !== null &&
        (typeof sessionBinding !== 'string' || !/^[0-9a-f]{64}$/.test(sessionBinding)))
      throw new Error('invalid_session_binding');
    this.#pruneJobs();
    // A pending job must not be delivered to a disconnected or revoked TX.
    if (!this.#devices.get(deviceId)?.online || !this.#devices.get(deviceId)?.bridgeEnabled) return null;
    for (const job of this.#jobs.values()) {
      if (job.deviceId !== deviceId || job.state !== 'queued') continue;
      if (!this.#grants.get(this.#grantKey(job.deviceId, job.receiverId))?.active) {
        this.#jobs.delete(job.jobId);
        continue;
      }
      job.state = 'sent';
      job.sessionBinding = sessionBinding;
      const { sessionBinding: _private, ...publicJob } = job;
      return { ...publicJob };
    }
    return null;
  }

  /**
   * Resolve receiver identity from the server-owned job, not from a TX payload.
   * This is an in-process method, NOT a network route.
   */
  completeByDevice({ jobId, deviceId, sessionBinding = null }) {
    const job = this.#jobs.get(jobId);
    if (!job || job.deviceId !== deviceId ||
        job.sessionBinding !== sessionBinding)
      throw new Error('job_not_authorized');
    return this.complete({ jobId, deviceId, receiverId: job.receiverId });
  }

  complete({ jobId, deviceId, receiverId }) {
    this.#pruneJobs();
    const job = this.#jobs.get(jobId);
    if (!job || job.deviceId !== deviceId || job.receiverId !== receiverId ||
        job.state !== 'sent' || !this.#devices.get(deviceId)?.online ||
        !this.#devices.get(deviceId)?.bridgeEnabled ||
        !this.#grants.get(this.#grantKey(deviceId, receiverId))?.active)
      throw new Error('job_not_authorized');
    job.state = 'done';
    const { sessionBinding: _private, ...publicJob } = job;
    return { ...publicJob };
  }
}
