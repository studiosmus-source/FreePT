/**
 * Pure Bridge routing model. NO network, file access, persistence or Android hooks.
 * A production backend must authenticate callers, validate tokens and persist grants.
 */
export class BridgeRegistry {
  #devices = new Map();
  #grants = new Map();
  #jobs = new Map();

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
    device.online = online === true && device.bridgeEnabled;
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
    if (grant) grant.active = false;
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
    if (!jobId || !deviceId || !receiverId || !operation) throw new Error('invalid_job');
    if (this.#jobs.has(jobId)) throw new Error('duplicate_job');
    const device = this.#devices.get(deviceId);
    if (!device?.online || !device.bridgeEnabled) throw new Error('device_offline');
    if (!this.#grants.get(this.#grantKey(deviceId, receiverId))?.active) throw new Error('bridge_not_authorized');
    this.#jobs.set(jobId, { jobId, deviceId, receiverId, operation, state: 'queued' });
  }

  takeNext(deviceId) {
    // A pending job must not be delivered to a disconnected or revoked TX.
    if (!this.#devices.get(deviceId)?.online || !this.#devices.get(deviceId)?.bridgeEnabled) return null;
    for (const job of this.#jobs.values()) {
      if (job.deviceId !== deviceId || job.state !== 'queued') continue;
      if (!this.#grants.get(this.#grantKey(job.deviceId, job.receiverId))?.active) {
        this.#jobs.delete(job.jobId);
        continue;
      }
      job.state = 'sent';
      return { ...job };
    }
    return null;
  }

  complete({ jobId, deviceId, receiverId }) {
    const job = this.#jobs.get(jobId);
    if (!job || job.deviceId !== deviceId || job.receiverId !== receiverId ||
        job.state !== 'sent' || !this.#devices.get(deviceId)?.online ||
        !this.#devices.get(deviceId)?.bridgeEnabled ||
        !this.#grants.get(this.#grantKey(deviceId, receiverId))?.active)
      throw new Error('job_not_authorized');
    this.#jobs.delete(jobId);
    return { ...job, state: 'done' };
  }
}
