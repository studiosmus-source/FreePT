/**
 * Local-only Node HTTP adapter for Bridge admin request-contract tests.
 *
 * Not deployable: binds exclusively to 127.0.0.1 on an ephemeral port,
 * requires an injected handler, and never enrolls TX devices or accesses files.
 * No Supabase credentials, Android routes, or production configuration.
 */
import { createServer } from 'node:http';

// Max 100 bounded file entries in a single authenticated catalogue response.
const MAX_BYTES = 32768;
class RequestBodyError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
function reply(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(JSON.stringify(body));
}
async function parseBody(req) {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json')
    throw new RequestBodyError(415, 'unsupported_media_type');
  const contentLength = req.headers['content-length'];
  if (contentLength !== undefined && (/^\d+$/.test(contentLength) === false ||
      Number(contentLength) > MAX_BYTES))
    throw new RequestBodyError(413, 'payload_too_large');
  const buffers = [];
  let bytes = 0;
  for await (const part of req) {
    bytes += part.length;
    if (bytes > MAX_BYTES) throw new RequestBodyError(413, 'payload_too_large');
    buffers.push(part);
  }
  try {
    return JSON.parse(Buffer.concat(buffers).toString('utf8'));
  } catch {
    throw new RequestBodyError(400, 'invalid_json');
  }
}
export function createBridgeLoopbackTestServer({ handler, txHandler = null }) {
  if (typeof handler !== 'function' ||
      (txHandler !== null && typeof txHandler !== 'function'))
    throw new Error('invalid_http_handler');
  const server = createServer(async (req, res) => {
    try {
      if (req.method !== 'POST') {
        reply(res, 405, {error:'method_not_allowed'});
        return;
      }
      const adminPaths = ['/bridge/admin/list','/bridge/admin/status','/bridge/admin/cancel','/bridge/admin/folder'];
      const txPaths = ['/bridge/tx/connect','/bridge/tx/poll','/bridge/tx/complete','/bridge/tx/disconnect','/bridge/tx/folder'];
      const txRoute = txPaths.includes(req.url);
      if (!adminPaths.includes(req.url) && !(txHandler && txRoute)) {
        reply(res, 404, {error:'not_found'});
        return;
      }
      const body = await parseBody(req);
      const response = await (txRoute ? txHandler : handler)({
        method:req.method, path:req.url,
        headers:{authorization:req.headers.authorization}, body
      });
      reply(res, response.status, response.body);
    } catch (error) {
      reply(res, error instanceof RequestBodyError ? error.status : 400,
        {error: error instanceof RequestBodyError ? error.code : 'invalid_request'});
    }
  });
  return {
    async start() {
      if (server.listening) throw new Error('already_started');
      await new Promise((resolve, reject) => {
        server.once('error',reject);
        server.listen(0,'127.0.0.1',resolve);
      });
      return 'http://127.0.0.1:' + server.address().port;
    },
    async stop() {
      if (server.listening)
        await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
    }
  };
}
