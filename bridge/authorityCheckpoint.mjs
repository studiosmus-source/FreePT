/**
 * Authoritative permission checkpoint for a future shared Bridge datastore.
 * This module does NOT implement a database or grant network access.
 *
 * The trusted backend must provide readAuthorization: a fresh, authoritative
 * and transactionally consistent read of one device/receiver pair. No cache,
 * client-provided rows, or local BridgeRegistry snapshot may back this read.
 * Operations must still be fenced by a database transaction in production:
 * a read alone cannot eliminate a revoke-vs-dispatch race.
 */
export class BridgeAuthorityCheckpoint {
  constructor({ readAuthorization }) {
    if (typeof readAuthorization !== 'function')
      throw new Error('invalid_authority_dependency');
    this.readAuthorization = readAuthorization;
  }

  async assertAuthorized({ deviceId, receiverId }) {
    if (typeof deviceId !== 'string' || !deviceId ||
        typeof receiverId !== 'string' || !receiverId)
      throw new Error('bridge_authority_denied');

    let row;
    try {
      row = await this.readAuthorization({ deviceId, receiverId });
    } catch {
      throw new Error('bridge_authority_unavailable');
    }
    // Exact match is required: never trust a row fetched for another pair.
    if (!row || typeof row !== 'object' || Array.isArray(row) ||
        row.deviceId !== deviceId || row.receiverId !== receiverId ||
        row.bridgeEnabled !== true || row.grantActive !== true ||
        row.receiverApproved !== true)
      throw new Error('bridge_authority_denied');

    return { deviceId, receiverId };
  }
}
