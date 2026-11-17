/**
 * Server-only trusted auth composition for the persistent Bridge.
 * Caller injects distinct server-controlled clients; this never creates
 * credentials, opens a listener, enrolls devices, or alters production data.
 *
 * Host must provide HTTPS, request throttling and deployment isolation.
 */
import {createSupabaseBridgeAdminAuthenticator} from './supabaseAdminAuth.mjs';
import {createPostgresDeviceAuthenticator} from './postgresDeviceAuth.mjs';
import {createBridgePostgresRequestHandlers} from './postgresRequestHandlers.mjs';

export function createTrustedBridgeBackend({
  authClient, profilesClient, verifiersClient, rpcClient,
  newJobId, txRateLimits,readJobsEnabled=false
} = {}) {
  const authenticateAdmin=createSupabaseBridgeAdminAuthenticator({
    authClient,profilesClient
  });
  const authenticateDevice=createPostgresDeviceAuthenticator({verifiersClient});
  return createBridgePostgresRequestHandlers({
    rpcClient,authenticateAdmin,authenticateDevice,readJobsEnabled,
    ...(newJobId===undefined?{}:{newJobId}),
    ...(txRateLimits===undefined?{}:{txRateLimits})
  });
}
