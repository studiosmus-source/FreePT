import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../android-bridge/BridgeCredentialsPlugin.java.template',import.meta.url),'utf8');
test('native enrollment normalizes optional HTTPS endpoint slash',()=>{
  assert.match(source,/root\.toExternalForm\(\)\.replaceAll\("\/\+\$",""\)\+"\/bridge\/owner\/"\+action/);
  assert.doesNotMatch(source,/endpoint\+"\/bridge\/owner\/"\+action/);
});
test('only owner enrollment and delete are permitted from native app',()=>{
  assert.match(source,/"enroll"\.equals\(action\)\|\|"delete"\.equals\(action\)/);
  assert.match(source,/setInstanceFollowRedirects\(false\)/);
  assert.match(source,/setRequestProperty\("Authorization","Bearer "\+token\)/);
});
