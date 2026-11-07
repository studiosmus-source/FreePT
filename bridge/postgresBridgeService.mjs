/**
 * Server-side composition of the existing persistent Bridge session and job
 * adapters. This is not an HTTP listener, a file transfer service or a client
 * entrypoint. The caller must inject server-trusted RPC/auth dependencies.
 *
 * No service-role credential may be bundled in src/ or an Android APK.
 */
import {BridgePostgresJobsAdapter} from './postgresJobsAdapter.mjs';
import {BridgePostgresTxSessions} from './postgresTxSessions.mjs';

export function createBridgePostgresService({
  rpcClient, authenticateAdmin, authenticateDevice
}) {
  if (typeof rpcClient?.rpc !== 'function' ||
      typeof authenticateAdmin !== 'function' ||
      typeof authenticateDevice !== 'function')
    throw new Error('invalid_bridge_postgres_service_dependencies');

  const sessions = new BridgePostgresTxSessions({rpcClient, authenticateDevice});
  const jobs = new BridgePostgresJobsAdapter({
    rpcClient, sessions, authenticateAdmin
  });

  // Only the fixed-list metadata job is supported. All authorization and
  // consent decisions remain inside the trusted auth callbacks and DB RPCs.
  return Object.freeze({
    requestList: params => jobs.requestList(params),
    getRequestStatus: params => jobs.getRequestStatus(params),
    cancelRequest: params => jobs.cancelRequest(params),
    connectDevice: params => sessions.connect(params),
    pollDevice: params => jobs.pollDevice(params),
    completeDevice: params => jobs.completeDevice(params),
    closeDeviceSession: params => sessions.close(params)
  });
}
