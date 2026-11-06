/**
 * Local-only Node HTTP adapter for Bridge admin request-contract tests.
 *
 * Not deployable: binds exclusively to 127.0.0.1 on an ephemeral port,
 * requires an injected handler, and never enrolls TX devices or accesses files.
 * No Supabase credentials, Android routes, or production configuration.
 */
import { createServer } from 'node:http';

const MAX_BYTES = 2048;
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
    throw new Error('invalid_content_type');
  const buffers = [];
  let bytes = 0;
  for await (const part of req) {
    bytes += part.length;
    if (bytes > MAX_BYTES) throw new Error('payload_too_large');
    buffers.push(part);
  }
  try {
    return JSON.parse(Buffer.concat(buffers).toString('utf8'));
  } catch {
    throw new Error('invalid_json');
  }
}
export function createBridgeLoopbackTestServer({ handler }) {
  if (typeof handler !== 'function') throw new Error('invalid_http_handler');
  const server = createServer(async (req, res) => {
    try {
      if (req.method !== 'POST') {
        reply(res, 405, {error:'method_not_allowed'});
        return;
      }
      if (!['/bridge/admin/list','/bridge/admin/status','/bridge/admin/cancel'].includes(req.url)) {
        reply(res, 404, {error:'not_found'});
        return;
      }
      const body = await parseBody(req);
      const response = await handler({
        method:req.method, path:req.url,
        headers:{authorization:req.headers.authorization}, body
      });
      reply(res, response.status, response.body);
    } catch {
      reply(res, 400, {error:'invalid_request'});
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
