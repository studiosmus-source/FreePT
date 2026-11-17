/**
 * Experimental transaction-bound authority contract, no database connection.
 *
 * withLockedAuthorization must serialize revocations, owner OFF, grant changes
 * and the accompanying mutation using one authoritative transactional resource.
 * This is NOT accomplished by BridgeRegistry's in-memory state alone.
 *
 * The callback is valid only while the backend's lock is held; delayed/repeated
 * invocation is explicitly denied. The backend must roll back on errors.
 * For multi-process production jobs, both grant checks AND job changes must be
 * persisted in that transaction; wrapping a local Map is NOT sufficient.
 */
export class BridgeTransactionalAuthority {
  constructor({ withLockedAuthorization }) {
    if (typeof withLockedAuthorization !== 'function')
      throw new Error('invalid_transactional_authority_dependency');
    this.withLockedAuthorization = withLockedAuthorization;
  }

  async runAuthorized({ deviceId, receiverId }, mutate) {
    if (typeof deviceId !== 'string' || !deviceId ||
        typeof receiverId !== 'string' || !receiverId ||
        typeof mutate !== 'function')
      throw new Error('bridge_authority_denied');
    let active = false;
    let invoked = false;
    let completed = false;
    const guardedMutation = () => {
      if (!active || invoked) throw new Error('bridge_transaction_invalid');
      invoked = true;
      // Mutations must be synchronous and complete before the transaction ends.
      const result = mutate();
      if (result && typeof result.then === 'function')
        throw new Error('bridge_transaction_async_mutation');
      return result;
    };
    try {
      const result = await this.withLockedAuthorization({
        deviceId, receiverId,
        mutate: () => {
          if (completed) throw new Error('bridge_transaction_invalid');
          active = true;
          try {
            return guardedMutation();
          } finally {
            active = false;
          }
        }
      });
      completed = true;
      if (!invoked) throw new Error('bridge_transaction_not_committed');
      return result;
    } catch (error) {
      completed = true;
      if (/^bridge_transaction_/.test(error?.message || '')) throw error;
      if (error?.message === 'bridge_authority_denied' ||
          error?.message === 'bridge_authority_retry')
        throw error;
      throw new Error('bridge_authority_unavailable');
    }
  }
}
