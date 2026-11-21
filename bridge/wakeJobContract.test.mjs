import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('bounded TX wake does not equate an unexpired server session with a running worker',()=>{
 const sender=read('supabase/functions/freept-bridge-wake/index.ts');
 assert.doesNotMatch(sender,/wake:'already_connected'/);
 assert.doesNotMatch(sender,/from\('bridge_tx_sessions'\)/);
 assert.match(sender,/job\.state!=='queued'/);
 assert.match(sender,/\.is\('revoked_at',null\)/);
 assert.match(sender,/if\(now-previous<2000\)/);
 assert.match(sender,/kind:'bridge_wake',version:'1'/);
 assert.match(sender,/priority:'HIGH'/);
});
test('admin client requests on-demand wakes again for a new job after brief cooldown',()=>{
 const client=read('src/bridgeAdminClient.js');
 assert.match(client,/if\(now-previous<2000\)return/);
 assert.match(client,/notifyWake\(result\)/);
});
