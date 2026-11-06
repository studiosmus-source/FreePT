/**
 * Pure Bridge routing model. NO network, file access, persistence or Android hooks.
 * A production backend must authenticate callers, validate tokens and persist grants.
 */
export class BridgeRegistry {
  #devices = new Map();
  #grants = new Map();
  #jobs = new Map();

  registerDevice({ id, ownerId, label }) {
    if (!id || !ownerId || !label || typeof id !== 'string' ||
        typeof ownerId !== 'string' || typeof label !== 'string')
      throw new Error('invalid_device');
    if (this.#devices.has(id)) throw new Error('device_already_registered');
    this.#devices.set(id, { id, ownerId, label, online: false });
  }

  setOnline(deviceId, online) {
    const device = this.#devices.get(deviceId);
    if (!device) throw new Error('unknown_device');
    device.online = online === true;
  }

  /** Called only after a backend-validated, explicit owner approval. */
  grant({ deviceId, receiverId, approvedByOwnerId }) {
    const device = this.#devices.get(deviceId);
    if (!device) throw new Error('unknown_device');
    if (device.ownerId !== approvedByOwnerId || !receiverId)
      throw new Error('approval_required');
    this.#grants.set(deviceId + ':' + receiverId, { deviceId, receiverId, active: true });
  }

  revoke({ deviceId, receiverId, approvedByOwnerId }) {
    const device = this.#devices.get(deviceId);
    if (!device || device.ownerId !== approvedByOwnerId) throw new Error('owner_required');
    const grant = this.#grants.get(deviceId + ':' + receiverId);
    if (grant) grant.active = false;
    for (const [id, job] of this.#jobs) {
      if (job.deviceId === deviceId && job.receiverId === receiverId) this.#jobs.delete(id);
    }
  }

  listApproved(receiverId) {
    return [...this.#devices.values()]
      .filter(device => this.#grants.get(device.id + ':' + receiverId)?.active)
      .map(device => ({ ...device }));
  }

  /** No implicit default TX. Job is bound to exactly one device and receiver. */
  enqueue({ jobId, deviceId, receiverId, operation }) {
    if (!jobId || !deviceId || !receiverId || !operation) throw new Error('invalid_job');
    if (this.#jobs.has(jobId)) throw new Error('duplicate_job');
    const device = this.#devices.get(deviceId);
    if (!device?.online) throw new Error('device_offline');
    if (!this.#grants.get(deviceId + ':' + receiverId)?.active) throw new Error('bridge_not_authorized');
    this.#jobs.set(jobId, { jobId, deviceId, receiverId, operation, state: 'queued' });
  }

  takeNext(deviceId) {
    for (const job of this.#jobs.values()) {
      if (job.deviceId === deviceId && job.state === 'queued') {
        job.state = 'sent';
        return { ...job };
      }
    }
    return null;
  }

  complete({ jobId, deviceId, receiverId }) {
    const job = this.#jobs.get(jobId);
    if (!job || job.deviceId !== deviceId || job.receiverId !== receiverId ||
        job.state !== 'sent' ||
        !this.#grants.get(deviceId + ':' + receiverId)?.active)
      throw new Error('job_not_authorized');
    this.#jobs.delete(jobId);
    return { ...job, state: 'done' };
  }
}
