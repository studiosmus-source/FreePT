/**
 * TX request contract for local-only Bridge integration tests.
 * No file reads, enrollment, device discovery, or production HTTP listener.
 * Caller must provide the trusted in-process service; real deployment requires
 * TLS, consent persistence, anti-bruteforce throttling and a trusted backend.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX = /^[0-9a-f]{64}$/;
const ROUTES = {
  '/bridge/tx/connect': ['deviceId', 'deviceSecret'],
  '/bridge/tx/poll': ['deviceId', 'sessionToken'],
  '/bridge/tx/complete': ['deviceId', 'sessionToken', 'jobId']
};
const fail = (status, code) => ({status, body:{error:code}});
const shape = (value, keys) =>
  !!value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  keys.every(key => Object.prototype.hasOwnProperty.call(value,key));
export function createBridgeTxRequestHandler({service}) {
  if (!service || typeof service.connectDevice !== 'function' ||
      typeof service.pollDevice !== 'function' ||
      typeof service.completeDevice !== 'function')
    throw new Error('invalid_tx_request_dependencies');
  return async function handleBridgeTxRequest(request) {
    if (request?.method !== 'POST') return fail(405,'method_not_allowed');
    const keys = ROUTES[request?.path];
    if (!keys) return fail(404,'not_found');
    const body = request?.body;
    if (!shape(body,keys) || !UUID.test(body.deviceId) ||
        (keys.includes('jobId') && !UUID.test(body.jobId)) ||
        (keys.includes('deviceSecret') &&
          (typeof body.deviceSecret !== 'string' || !HEX.test(body.deviceSecret))) ||
        (keys.includes('sessionToken') &&
          (typeof body.sessionToken !== 'string' || !HEX.test(body.sessionToken))))
      return fail(400,'invalid_request');
    try {
      if (request.path === '/bridge/tx/connect')
        return {status:200,body:service.connectDevice({
          deviceId:body.deviceId,deviceSecret:body.deviceSecret
        })};
      if (request.path === '/bridge/tx/poll')
        return {status:200,body:{job:service.pollDevice({
          deviceId:body.deviceId,sessionToken:body.sessionToken
        })}};
      return {status:200,body:service.completeDevice({
        deviceId:body.deviceId,sessionToken:body.sessionToken,jobId:body.jobId
      })};
    } catch {
      // Do not disclose whether a device exists or its consent/credential state.
      return fail(403,'tx_denied');
    }
  };
}
