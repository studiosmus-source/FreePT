/**
 * Isolated server-side TX session gate. NO HTTP routes or client integration.
 *
 * Opening a TX session proves knowledge of a device-specific secret, not
 * ownership of a phone. Caller must also verify owner enrollment, TLS and
 * database state in a production backend.
 *
 * Authorization is rechecked for EACH operation, not only at login.
 */
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

const TOKEN_RE = /^[0-9a-f]{64}$/;
const MAX_AGE_MS = 5 * 60 * 1000;

function hashToken(token) {
  return createHash('sha256').update('freept-bridge-session-v1\0')
    .update(token).digest();
}

export class BridgeDeviceSessionGate {
  #sessions = new Map();

  constructor({ credentials, registry, now = () => Date.now() }) {
    if (!credentials || !registry || typeof now !== 'function')
      throw new Error('invalid_session_dependencies');
    this.credentials = credentials;
    this.registry = registry;
    this.now = now;
  }

  /** Starts a short-lived TX-only session after secret verification. */
  open({ deviceId, secret }) {
    if (!this.credentials.authenticate(deviceId, secret))
      throw new Error('device_not_authenticated');
    const verifier = this.credentials.exportVerifier(deviceId);
    if (!verifier) throw new Error('device_not_authenticated');
    const token = randomBytes(32).toString('hex');
    const tokenHash = hashToken(token);
    const expiresAt = this.now() + MAX_AGE_MS;
    this.#sessions.set(tokenHash.toString('hex'), {
      deviceId,
      verifier: verifier.verifier,
      expiresAt
    });
    // This bearer token must travel only over authenticated TLS and
    // must never be logged or stored in a client-accessible database.
    return { token, expiresAt };
  }

  /**
   * The receiver identity is a TRUSTED backend context, never a plain
   * unverified HTTP parameter. Recheck grant, TX state and token rotation.
   */
  authorize({ token, deviceId, receiverId }) {
    if (typeof token !== 'string' || !TOKEN_RE.test(token))
      throw new Error('invalid_device_session');
    const tokenHash = hashToken(token).toString('hex');
    const state = this.#sessions.get(tokenHash);
    if (!state || state.deviceId !== deviceId)
      throw new Error('invalid_device_session');
    if (this.now() >= state.expiresAt) {
      this.#sessions.delete(tokenHash);
      throw new Error('device_session_expired');
    }
    const current = this.credentials.exportVerifier(deviceId);
    if (!current) {
      this.#sessions.delete(tokenHash);
      throw new Error('device_session_revoked');
    }
    const savedVerifier = Buffer.from(state.verifier, 'hex');
    const liveVerifier = Buffer.from(current.verifier, 'hex');
    if (savedVerifier.length !== liveVerifier.length ||
        !timingSafeEqual(savedVerifier, liveVerifier)) {
      this.#sessions.delete(tokenHash);
      throw new Error('device_session_revoked');
    }

    const device = this.registry.getDeviceStatus({ deviceId, receiverId });
    if (device.state !== 'online') throw new Error('bridge_unavailable');
    return { deviceId, receiverId };
  }

  close(token) {
    if (typeof token !== 'string' || !TOKEN_RE.test(token)) return false;
    return this.#sessions.delete(hashToken(token).toString('hex'));
  }
}
