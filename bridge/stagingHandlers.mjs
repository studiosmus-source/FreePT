/**
 * Backend-only composition for the staging Bridge protocol.
 *
 * This module creates NO network listener, storage connection, enrollment,
 * file enumeration or external deployment. The caller owns TLS, credentials,
 * request limits and environment configuration. Never import into src/main.js.
 *
 * RPC client MUST be trusted server-side (not a browser Supabase client).
 */
import { createSupabaseBridgeAdminAuthenticator } from './supabaseAdminAuth.mjs';
import { BridgePostgresTxSessions } from './postgresTxSessions.mjs';
import { BridgePostgresJobsAdapter } from './postgresJobsAdapter.mjs';
import { createBridgeAdminRequestHandler } from './adminRequestHandler.mjs';
import { createBridgeTxRequestHandler } from './txRequestHandler.mjs';

export function createBridgeStagingHandlers({
  authClient, profilesClient, rpcClient, authenticateDevice,
  newJobId,readJobsEnabled=false
}) {
  if (typeof authClient?.auth?.getUser !== 'function' ||
      typeof profilesClient?.from !== 'function' ||
      typeof rpcClient?.rpc !== 'function' ||
      typeof authenticateDevice !== 'function')
    throw new Error('invalid_bridge_staging_dependencies');

  const authenticateAdmin = createSupabaseBridgeAdminAuthenticator({
    authClient, profilesClient
  });
  const sessions = new BridgePostgresTxSessions({
    rpcClient, authenticateDevice
  });
  const jobs = new BridgePostgresJobsAdapter({
    rpcClient, sessions, authenticateAdmin,readJobsEnabled
  });
  // TX must prove device identity before receiving a database session.
  // The PostgreSQL RPCs independently enforce current consent and session
  // binding at job claim/completion inside their database transactions.
  const txService = {
    connectDevice: ({ deviceId, deviceSecret }) =>
      sessions.connect({ deviceId, deviceSecret }),
    pollDevice: ({ deviceId, sessionToken }) =>
      jobs.pollDevice({ deviceId, sessionToken }),
    completeDevice: ({ deviceId, sessionToken, jobId }) =>
      jobs.completeDevice({ deviceId, sessionToken, jobId }),
    completeFolderPage: ({ deviceId, sessionToken, jobId, entries }) =>
      jobs.completeFolderPage({ deviceId, sessionToken, jobId, entries }),
    completeRead: ({ deviceId, sessionToken, jobId, chunk }) =>
      jobs.completeRead({ deviceId, sessionToken, jobId, chunk })
  };
  const adminHandler = createBridgeAdminRequestHandler({
    service: jobs,
    ...(newJobId === undefined ? {} : { newJobId })
  });
  const txHandler = createBridgeTxRequestHandler({ service: txService });
  return Object.freeze({ adminHandler, txHandler });
}
