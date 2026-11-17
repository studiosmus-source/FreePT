/**
 * Backend-only wiring for the existing Bridge admin and TX request contracts.
 * The host is responsible for HTTPS, CORS/origin checks, replay/rate limits,
 * secret provisioning, and injecting SERVER-OWNED RPC/auth clients.
 * No listener, environment access, Supabase key, or filesystem operation here.
 */
import {createBridgePostgresService} from './postgresBridgeService.mjs';
import {createBridgeAdminRequestHandler} from './adminRequestHandler.mjs';
import {createBridgeTxRequestHandler} from './txRequestHandler.mjs';

export function createBridgePostgresRequestHandlers({
  rpcClient, authenticateAdmin, authenticateDevice,
  newJobId, txRateLimits, readJobsEnabled=false
} = {}) {
  const service=createBridgePostgresService({
    rpcClient, authenticateAdmin, authenticateDevice,readJobsEnabled
  });
  const admin=createBridgeAdminRequestHandler({
    service, ...(newJobId===undefined?{}:{newJobId})
  });
  const tx=createBridgeTxRequestHandler({
    service, ...(txRateLimits===undefined?{}:txRateLimits)
  });
  return Object.freeze({admin,tx});
}
