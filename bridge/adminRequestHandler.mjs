/**
 * In-process REST request contract for the Bridge admin boundary.
 *
 * This is NOT an HTTP listener. The trusted backend must terminate TLS,
 * apply origin/rate/body limits, and pass a verified request object here.
 * Only three fixed admin actions exist. No TX enrollment, filesystem access,
 * uploads, remote commands, or production service setup.
 *
 * Authorization is taken solely from a Bearer header; the verified Supabase
 * authenticator checks the user and profiles table on every operation.
 */
import { randomUUID } from 'node:crypto';
import {validateBridgeReadRequest} from '../src/bridgeFileProtocol.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(status, code) {
  return { status, body: { error: code } };
}
function own(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}
function onlyKeys(value, keys) {
  return value !== null && typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).every(key => keys.includes(key));
}
function bearer(headers) {
  if (!headers || typeof headers !== 'object') return null;
  const raw = headers.authorization;
  if (typeof raw !== 'string') return null;
  const match = /^Bearer ([^\s]{20,8192})$/.exec(raw);
  return match ? match[1] : null;
}

export function createBridgeAdminRequestHandler({ service, newJobId = randomUUID }) {
  if (!service || typeof service.requestList !== 'function' ||
      typeof service.getRequestStatus !== 'function' ||
      typeof service.cancelRequest !== 'function' ||
      typeof newJobId !== 'function')
    throw new Error('invalid_bridge_request_dependencies');

  return async function handleBridgeAdminRequest(request) {
    // No arbitrary URL paths, method override, or data-driven commands.
    const method = request?.method;
    const path = request?.path;
    if (method !== 'POST') return fail(405, 'method_not_allowed');
    if (!['/bridge/admin/list', '/bridge/admin/status', '/bridge/admin/cancel', '/bridge/admin/folder','/bridge/admin/read','/bridge/admin/chunk','/bridge/admin/browse','/bridge/admin/browse-page'].includes(path))
      return fail(404, 'not_found');
    const token = bearer(request?.headers);
    if (!token) return fail(401, 'authentication_required');
    const body = request?.body;
    if (!onlyKeys(body, path === '/bridge/admin/list' ? ['deviceId'] :
        path === '/bridge/admin/read' ? ['deviceId','handle','offset','length'] :
        path === '/bridge/admin/browse' ? ['deviceId','handle','offset'] : ['jobId']))
      return fail(400, 'invalid_request');
    if (path === '/bridge/admin/list'||path === '/bridge/admin/read'||path === '/bridge/admin/browse') {
      if (!own(body, 'deviceId') || typeof body.deviceId !== 'string' ||
          !UUID.test(body.deviceId)) return fail(400, 'invalid_device_id');
    } else if (!own(body, 'jobId') || typeof body.jobId !== 'string' ||
               !UUID.test(body.jobId)) return fail(400, 'invalid_job_id');

    if (path === '/bridge/admin/read') {
      try {
        const request=validateBridgeReadRequest({
          handle:body.handle,offset:body.offset,length:body.length
        });
        if(request.length>32768)return fail(400,'bridge_read_invalid');
      }catch{return fail(400,'bridge_read_invalid');}
    }
    if(path === '/bridge/admin/browse' &&
       (!(body.handle==='root'||UUID.test(body.handle))||
        !Number.isSafeInteger(body.offset)||body.offset<0||body.offset>10000))
      return fail(400,'bridge_browse_invalid');
    const authContext = { accessToken: token };
    try {
      if (path === '/bridge/admin/list') {
        const jobId = newJobId();
        if (typeof jobId !== 'string' || !UUID.test(jobId))
          throw new Error('invalid_generated_job_id');
        const result = await service.requestList({
          authContext, deviceId: body.deviceId, jobId
        });
        return { status: 202, body: result };
      }
      if(path === '/bridge/admin/browse'){
        if(typeof service.requestBrowse!=='function')return fail(404,'not_found');
        const jobId=newJobId();
        if(typeof jobId!=='string'||!UUID.test(jobId))
          throw Error('invalid_generated_job_id');
        return {status:202,body:await service.requestBrowse({
          authContext,deviceId:body.deviceId,jobId,handle:body.handle,offset:body.offset
        })};
      }
      if(path === '/bridge/admin/browse-page'){
        if(typeof service.getBrowsePage!=='function')return fail(404,'not_found');
        return {status:200,body:await service.getBrowsePage({authContext,jobId:body.jobId})};
      }
      if (path === '/bridge/admin/read') {
        if(typeof service.requestRead!=='function')return fail(404,'not_found');
        const jobId=newJobId();
        if(typeof jobId!=='string'||!UUID.test(jobId))
          throw Error('invalid_generated_job_id');
        return {status:202,body:await service.requestRead({
          authContext,deviceId:body.deviceId,jobId,
          handle:body.handle,offset:body.offset,length:body.length
        })};
      }
      if(path === '/bridge/admin/chunk'){
        if(typeof service.getReadChunk!=='function')return fail(404,'not_found');
        return {status:200,body:await service.getReadChunk({authContext,jobId:body.jobId})};
      }
      if (path === '/bridge/admin/folder') {
        if (typeof service.getFolderPage !== 'function') return fail(404,'not_found');
        return {status:200,body:await service.getFolderPage({
          authContext,jobId:body.jobId
        })};
      }
      if (path === '/bridge/admin/status')
        return { status: 200, body: await service.getRequestStatus({
          authContext, jobId: body.jobId
        }) };
      return { status: 200, body: await service.cancelRequest({
        authContext, jobId: body.jobId
      }) };
    } catch (error) {
      const code = String(error?.message || '');
      if (code === 'bridge_admin_required') return fail(403, 'bridge_denied');
      if (code === 'device_offline') return fail(409, 'device_unavailable');
      if (code === 'job_queue_full') return fail(429, 'queue_full');
      if (code === 'job_already_final') return fail(409, 'job_already_final');
      // Do not distinguish nonexistent from someone else's jobs or grants.
      if (code === 'job_not_authorized' || code === 'bridge_not_authorized')
        return fail(404, 'not_found');
      return fail(500, 'bridge_unavailable');
    }
  };
}
