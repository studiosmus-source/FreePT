/**
 * Trusted backend-only device authenticator using persisted verifiers.
 * Reads strictly one device row from a service-role Supabase client.
 * Never accept a caller-supplied verifier or export stored salts to TX.
 * Opening a session separately checks current verifier under device lock.
 */
import {verifyTrustedDeviceSecret} from './deviceCredentials.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX=/^[0-9a-f]{64}$/;
const SALT=/^[0-9a-f]{32}$/;

export function createPostgresDeviceAuthenticator({verifiersClient}) {
  if(typeof verifiersClient?.from!=='function')
    throw new Error('invalid_device_auth_dependencies');
  return async function authenticateDevice({deviceId,deviceSecret}={}) {
    if(typeof deviceId!=='string'||!UUID.test(deviceId)||
       typeof deviceSecret!=='string'||!HEX.test(deviceSecret))
      return null;
    let response;
    try {
      response=await verifiersClient.from('bridge_device_verifiers')
        .select('device_id,salt_hex,verifier_hex')
        .eq('device_id',deviceId).maybeSingle();
    } catch {
      throw new Error('bridge_device_verifier_unavailable');
    }
    if(!response||response.error)
      throw new Error('bridge_device_verifier_unavailable');
    const row=response.data;
    if(!row||typeof row!=='object'||Array.isArray(row)||
       row.device_id!==deviceId||!SALT.test(row.salt_hex)||
       !HEX.test(row.verifier_hex))return null;
    if(!verifyTrustedDeviceSecret({
      deviceId,secret:deviceSecret,salt:row.salt_hex,verifier:row.verifier_hex
    }))return null;
    return {verifierHex:row.verifier_hex};
  };
}
