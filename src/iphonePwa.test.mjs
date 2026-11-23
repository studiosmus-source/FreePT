import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const main=readFileSync(new URL('./main.js',import.meta.url),'utf8');
const manifest=JSON.parse(readFileSync(new URL('../public/manifest.webmanifest',import.meta.url),'utf8'));
const workflow=readFileSync(new URL('../.github/workflows/freept-ios-web.yml',import.meta.url),'utf8');
test('Safari PWA does not request native iPhone file access',()=>{
 assert.match(main,/const isIOSWebApp=import\.meta\.env\.VITE_IOS_WEB_APP==='true'&&!Capacitor\.isNativePlatform\(\)/);
 assert.match(main,/if\(isIOSUserApp&&!isIOSWebApp&&!denied&&!iosSetupAcknowledged\)/);
 assert.match(main,/const iosFiles = isIOS \? registerPlugin\('BridgeIOSFiles'\) : null/);
});
test('PWA retains approved-user chat and explicitly disables native bridge setup',()=>{
 assert.match(main,/db\.from\('messages'\)\.insert\(payload\)/);
 assert.match(main,/file=form\.elements\.file\.files\[0\]/);
 assert.match(workflow,/VITE_IOS_USER_APP: 'true'/);
 assert.match(workflow,/VITE_IOS_WEB_APP: 'true'/);
 assert.match(workflow,/VITE_BRIDGE_ISOLATED_BUILD: 'true'/);
});
test('home-screen manifest is installable in standalone mode',()=>{
 assert.equal(manifest.display,'standalone');
 assert.equal(manifest.start_url,'/');
 assert.ok(manifest.icons.some(icon=>icon.src==='/freept-icon.svg'));
});
