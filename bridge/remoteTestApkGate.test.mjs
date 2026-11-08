import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const text=readFileSync(new URL('../.github/workflows/bridge-android-staging.yml',import.meta.url),'utf8');
test('remote-file APK CI refuses missing HTTPS Bridge backend',()=>{
  assert.match(text,/FREEPT_BRIDGE_TEST_API_URL/);
  assert.match(text,/if not value:\s*\n\s*raise SystemExit\('Bridge remote-test APK refused:/);
  assert.doesNotMatch(text,/No external Bridge endpoint configured: admin stays read-only/);
  assert.match(text,/url\.scheme!='https'/);
  assert.match(text,/VITE_BRIDGE_TEST_API_URL: \$\{\{ vars\.FREEPT_BRIDGE_TEST_API_URL \}\}/);
});
