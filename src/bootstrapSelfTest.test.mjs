import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('./bootstrapAdminUi.js',import.meta.url),'utf8');
const main=readFileSync(new URL('./main.js',import.meta.url),'utf8');
const plugin=readFileSync(new URL('../android-bridge/BridgeBootstrapPlugin.java.template',import.meta.url),'utf8');
const core=readFileSync(new URL('../android-bridge/BridgeBootstrapCore.java.template',import.meta.url),'utf8');
test('Admin self-test is test-only, explicitly clicked and registered only in admin Bridge panel',()=>{
 assert.match(main,/if\(bridgeBootstrap\)mountBootstrapAdmin/);
 assert.match(main,/testNative:bridgeBootstrap,testFiles:bridgeAllFiles,testTx:bridgeTxControl/);
 assert.match(src,/id="bridgeSelfTest"/);
 assert.match(src,/button.onclick=async\(\)=>/);
});
test('Admin self-test signs up transient synthetic device, uses admin Auth approval and verifies native 300KB transfer',()=>{
 assert.match(src,/testNative.begin\(\)/);
 assert.match(src,/post\('approve',\{pairCode:registration.pairCode\}\)/);
 assert.match(src,/testTx.start\(\)/);
 assert.match(src,/testNative.status\(\)/);
 assert.match(src,/s\?\.verified===true/);
 assert.match(src,/SHA256/);
});
test('Admin self-test revokes, stops and clears only unbound diagnostic identity',()=>{
 assert.match(src,/post\('revoke',\{deviceId\}\)/);
 assert.match(src,/testTx.stop\(\)/);
 assert.match(src,/if\(clean\)\{try\{await testNative.resetUnboundTest\(\)/);
 assert.match(plugin,/@PluginMethod public void resetUnboundTest/);
 assert.match(core,/if\(bound\(c\)\|\|BridgeDeviceSecretStore.configured\(c\)\)/);
});
