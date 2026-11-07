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
  '/bridge/tx/complete': ['deviceId', 'sessionToken', 'jobId'],
  '/bridge/tx/disconnect': ['deviceId', 'sessionToken']
};
const fail = (status, code) => ({status, body:{error:code}});
const shape = (value, keys) =>
  !!value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  keys.every(key => Object.prototype.hasOwnProperty.call(value,key));
export function createBridgeTxRequestHandler({
  service, now = () => Date.now(), maxFailures = 5,
  windowMs = 60_000, cooldownMs = 60_000, maxTrackedDevices = 1000
}) {
  if (!service || typeof service.connectDevice !== 'function' ||
      typeof service.pollDevice !== 'function' ||
      typeof service.completeDevice !== 'function')
    throw new Error('invalid_tx_request_dependencies');
  if (typeof now !== 'function' || !Number.isSafeInteger(maxFailures) ||
      maxFailures < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1 ||
      !Number.isSafeInteger(cooldownMs) || cooldownMs < 1 ||
      !Number.isSafeInteger(maxTrackedDevices) || maxTrackedDevices < 1)
    throw new Error('invalid_tx_rate_limits');
  const failures = new Map();
  // Serialize login attempts per device: parallel requests must not bypass
  // the failed-attempt counter while device authentication is pending.
  const connectingDevices = new Set();
  function sweep(time) {
    for (const [id, state] of failures) {
      if (time >= state.until && time >= state.start + windowMs)
        failures.delete(id);
    }
  }
  function blocked(deviceId, time) {
    const state = failures.get(deviceId);
    if (!state) return false;
    if (time < state.until) return true;
    if (time >= state.start + windowMs) {
      failures.delete(deviceId);
      return false;
    }
    return false;
  }
  function failed(deviceId, time) {
    const state = failures.get(deviceId);
    if (!state || time >= state.start + windowMs) {
      failures.set(deviceId, {
        count: 1, start: time,
        until: maxFailures === 1 ? time + cooldownMs : 0
      });
      return;
    }
    state.count += 1;
    if (state.count >= maxFailures) state.until = time + cooldownMs;
  }
  return async function handleBridgeTxRequest(request) {
    if (request?.method !== 'POST') return fail(405,'method_not_allowed');
    const keys = ROUTES[request?.path];
    if (!keys || (request.path === '/bridge/tx/disconnect' &&
        typeof service.closeDeviceSession !== 'function'))
      return fail(404,'not_found');
    const body = request?.body;
    if (!shape(body,keys) || !UUID.test(body.deviceId) ||
        (keys.includes('jobId') && !UUID.test(body.jobId)) ||
        (keys.includes('deviceSecret') &&
          (typeof body.deviceSecret !== 'string' || !HEX.test(body.deviceSecret))) ||
        (keys.includes('sessionToken') &&
          (typeof body.sessionToken !== 'string' || !HEX.test(body.sessionToken))))
      return fail(400,'invalid_request');
    const connecting = request.path === '/bridge/tx/connect';
    if (connecting) {
      const time = now();
      sweep(time);
      if (blocked(body.deviceId,time) || connectingDevices.has(body.deviceId))
        return fail(429,'tx_rate_limited');
      if (!failures.has(body.deviceId) && failures.size >= maxTrackedDevices)
        return fail(429,'tx_rate_limited');
      connectingDevices.add(body.deviceId);
    }
    try {
      if (connecting) {
        const result = await service.connectDevice({
          deviceId:body.deviceId,deviceSecret:body.deviceSecret
        });
        failures.delete(body.deviceId);
        return {status:200,body:result};
      }
      if (request.path === '/bridge/tx/disconnect') {
        const closed=await service.closeDeviceSession({
          deviceId:body.deviceId,token:body.sessionToken
        });
        return closed===true ? {status:200,body:{closed:true}} : fail(403,'tx_denied');
      }
      if (request.path === '/bridge/tx/poll')
        return {status:200,body:{job:await service.pollDevice({
          deviceId:body.deviceId,sessionToken:body.sessionToken
        })}};
      return {status:200,body:await service.completeDevice({
        deviceId:body.deviceId,sessionToken:body.sessionToken,jobId:body.jobId
      })};
    } catch {
      // Do not disclose whether a device exists or its consent/credential state.
      if (connecting) failed(body.deviceId,now());
      return fail(403,'tx_denied');
    } finally {
      if (connecting) connectingDevices.delete(body.deviceId);
    }
  };
}
