import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const config=readFileSync(new URL('../render.yaml',import.meta.url),'utf8');
const gateway=readFileSync(new URL('./runHttpsStaging.mjs',import.meta.url),'utf8');
test('Render blueprint deploys isolated Bridge service, never production API',()=>{
  assert.match(config,/name: freept-bridge-staging/);
  assert.match(config,/startCommand: node bridge\/runHttpsStaging\.mjs/);
  assert.match(config,/healthCheckPath: \/health/);
  assert.match(config,/autoDeployTrigger: off/);
  assert.doesNotMatch(config,/cpopqsvzzxfjgnlawlvc/);
  assert.match(gateway,/createBridgeStagingHttpsService/);
});
test('service key remains configured privately, not committed as a value',()=>{
  for(const key of ['FREEPT_BRIDGE_TEST_SUPABASE_SERVICE_ROLE_KEY','FREEPT_BRIDGE_TEST_SUPABASE_URL',
     'FREEPT_BRIDGE_TEST_SUPABASE_PUBLISHABLE_KEY','FREEPT_BRIDGE_ALLOWED_ORIGINS']){
    assert.match(config,new RegExp('key: '+key+'\\n\\s+sync: false'));
  }
  assert.doesNotMatch(config,/sb_secret_[a-zA-Z0-9_-]{16,}/);
  assert.match(config,/FREEPT_BRIDGE_READ_ENABLED/);
});
