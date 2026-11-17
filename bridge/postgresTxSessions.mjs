/**
 * Backend-only PostgreSQL TX sessions adapter. No web endpoint or client key.
 * authenticateDevice MUST validate the raw device secret with a trusted,
 * current server-side verifier before returning its 64-hex verifier.
 * Never accept verifierHex from request bodies. The DB enforces current
 * verifier matching and session replacement atomically.
 *
 * The DB job RPC independently validates the session under the device lock,
 * so this optional early check is never the sole dispatch authorization.
 */
import {randomBytes,createHash} from 'node:crypto';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX=/^[0-9a-f]{64}$/;
function hashToken(token) {
  return createHash('sha256').update('freept-bridge-session-v1\0')
    .update(token).digest('hex');
}
export class BridgePostgresTxSessions {
  constructor({rpcClient,authenticateDevice}) {
    if(typeof rpcClient?.rpc!=='function'||typeof authenticateDevice!=='function')
      throw new Error('invalid_postgres_session_dependencies');
    this.rpcClient=rpcClient;
    this.authenticateDevice=authenticateDevice;
  }
  async #rpc(name,args) {
    let result;
    try { result=await this.rpcClient.rpc(name,args); }
    catch {throw new Error('bridge_session_database_unavailable');}
    if(!result||result.error)throw new Error('bridge_session_database_unavailable');
    return result.data;
  }
  async connect({deviceId,deviceSecret}) {
    if(!UUID.test(deviceId)||typeof deviceSecret!=='string'||!HEX.test(deviceSecret))
      throw new Error('device_not_authenticated');
    const verified=await this.authenticateDevice({deviceId,deviceSecret});
    if(!verified||typeof verified.verifierHex!=='string'||!HEX.test(verified.verifierHex))
      throw new Error('device_not_authenticated');
    const token=randomBytes(32).toString('hex');
    const binding=hashToken(token);
    const expires=await this.#rpc('bridge_server_open_tx_session',{
      p_device_id:deviceId,p_token_hash_hex:binding,
      p_verifier_hex:verified.verifierHex
    });
    if(typeof expires!=='string'||!Number.isFinite(Date.parse(expires)))
      throw new Error('bridge_session_invalid_response');
    return {token,expiresAt:Date.parse(expires)};
  }
  async getDispatchBinding({deviceId,token}) {
    if(!UUID.test(deviceId)||typeof token!=='string'||!HEX.test(token))
      throw new Error('invalid_device_session');
    const binding=hashToken(token);
    const result=await this.#rpc('bridge_server_assert_tx_session',{
      p_device_id:deviceId,p_token_hash_hex:binding
    });
    if(result!==binding)throw new Error('invalid_device_session');
    return binding;
  }
  async close({deviceId,token}) {
    if(!UUID.test(deviceId)||typeof token!=='string'||!HEX.test(token))
      throw new Error('invalid_device_session');
    const result=await this.#rpc('bridge_server_close_tx_session',{
      p_device_id:deviceId,p_token_hash_hex:hashToken(token)
    });
    if(typeof result!=='boolean')throw new Error('bridge_session_invalid_response');
    return result;
  }
}
