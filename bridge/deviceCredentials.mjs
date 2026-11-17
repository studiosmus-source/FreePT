/**
 * Backend-only device credential primitive.
 *
 * No HTTP API, Android integration, Supabase persistence or device registration.
 * Caller MUST verify that a trusted owner authorized enrollment/rotation, and
 * persist only the resulting verifier in a protected server-side database.
 *
 * A TX uses a distinct 256-bit bearer secret. Never put it in client logs,
 * messages, GitHub, or the general BridgeRegistry snapshot.
 */
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

const HEX_64 = /^[0-9a-f]{64}$/;
const HEX_32 = /^[0-9a-f]{32}$/;

function requiredId(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 128)
    throw new Error('invalid_device_id');
}

function digest(deviceId, salt, secret) {
  return createHash('sha256')
    .update('freept-bridge-device-v1\0')
    .update(deviceId)
    .update('\0')
    .update(salt)
    .update(secret)
    .digest();
}

/**
 * Verify a device bearer secret against a trusted backend-loaded verifier.
 * Uses the exact same KDF as BridgeDeviceCredentials; do not fork the hash
 * algorithm for Postgres. Never pass untrusted verifier records into this.
 */
export function verifyTrustedDeviceSecret({deviceId,secret,salt,verifier}) {
  if(typeof deviceId!=='string'||!deviceId||deviceId.length>128||
      typeof secret!=='string'||!HEX_64.test(secret)||
      typeof salt!=='string'||!HEX_32.test(salt)||
      typeof verifier!=='string'||!HEX_64.test(verifier)) return false;
  const supplied=Buffer.from(verifier,'hex');
  const candidate=digest(deviceId,salt,secret);
  return timingSafeEqual(supplied,candidate);
}

/** In-memory test fixture; use a transactional persistent backend in production. */
export class BridgeDeviceCredentials {
  #verifiers = new Map();

  /**
   * Called only after a verified owner-initiated enrollment. Never invoked by
   * submitting a deviceId alone. Returns the secret ONCE.
   */
  issue(deviceId) {
    requiredId(deviceId);
    if (this.#verifiers.has(deviceId)) throw new Error('device_credential_exists');
    return this.#replace(deviceId);
  }

  /** Invalidates the previous credential immediately in this instance. */
  rotate(deviceId) {
    requiredId(deviceId);
    if (!this.#verifiers.has(deviceId)) throw new Error('unknown_device_credential');
    return this.#replace(deviceId);
  }

  #replace(deviceId) {
    const secret = randomBytes(32).toString('hex');
    const salt = randomBytes(16).toString('hex');
    const verifier = digest(deviceId, salt, secret).toString('hex');
    this.#verifiers.set(deviceId, { salt, verifier });
    return { deviceId, secret };
  }

  revoke(deviceId) {
    requiredId(deviceId);
    return this.#verifiers.delete(deviceId);
  }

  authenticate(deviceId, secret) {
    // Malformed inputs fail closed and are never hashed with attacker-chosen size.
    if (typeof deviceId !== 'string' || typeof secret !== 'string' ||
        !HEX_64.test(secret)) return false;
    const record = this.#verifiers.get(deviceId);
    if (!record || !HEX_32.test(record.salt) || !HEX_64.test(record.verifier))
      return false;
    const expected = Buffer.from(record.verifier, 'hex');
    const presented = digest(deviceId, record.salt, secret);
    return timingSafeEqual(expected, presented);
  }

  /** Safe verifier data only; caller must save in access-controlled storage. */
  exportVerifier(deviceId) {
    requiredId(deviceId);
    const record = this.#verifiers.get(deviceId);
    if (!record) return null;
    return { deviceId, ...record };
  }

  /**
   * Only accept records loaded by the trusted backend, NEVER from a remote TX.
   * This replaces one record, not the state of every other device.
   */
  importTrustedVerifier({ deviceId, salt, verifier }) {
    requiredId(deviceId);
    if (!HEX_32.test(salt) || !HEX_64.test(verifier))
      throw new Error('invalid_device_verifier');
    this.#verifiers.set(deviceId, { salt, verifier });
  }
}
