import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const main=readFileSync(new URL('./main.js',import.meta.url),'utf8');
const push=readFileSync(new URL('./pushRegistration.js',import.meta.url),'utf8');
const config=JSON.parse(readFileSync(new URL('../capacitor.ios.config.json',import.meta.url),'utf8'));
const migration=readFileSync(new URL('../supabase/migrations/20261123_ios_push_platform.sql',import.meta.url),'utf8');
const notice=readFileSync(new URL('../supabase/functions/freept-important-alert/index.ts',import.meta.url),'utf8');
const chat=readFileSync(new URL('../supabase/functions/freept-push/index.ts',import.meta.url),'utf8');
test('iPhone uses native user-only registration and rejects Android Bridge plugins',()=>{
  assert.match(main,/const isIOS=Capacitor.getPlatform\(\)==='ios'/);
  assert.match(main,/const bridgeFiles = isAndroid && bridgeRuntime.enabled/);
  assert.match(main,/const freeptUpdater = isAndroid \?/);
  assert.match(main,/if\(!isIOSUserApp\)bindConcealedAdminEntry\(\)/);
  assert.match(main,/if\(isIOSUserApp&&profile.role==='admin'\)/);
  assert.match(main,/if\(isAndroid\)\{\s*\/\/ Android notification channels/);
});
test('iPhone shares only a user-selected document via existing chat attachment',()=>{
  assert.match(main,/id="iosShareFile"/);
  assert.match(main,/iosShare.onclick=\(\)=>document.getElementById\('file'\)\?\.click\(\)/);
  assert.match(main,/file=form.elements.file.files\[0\]/);
  assert.match(main,/await uploadAttachment\(path,file/);
  assert.match(main,/db.from\('messages'\).insert\(payload\)/);
  assert.doesNotMatch(main,/const bridgeFiles = Capacitor.isNativePlatform\(\)/);
});
test('APNs registration, migration and server routes are independently platform-scoped',()=>{
  assert.equal(config.appId,'it.freept.ios.user');
  assert.match(push,/platform='android'/);
  assert.match(push,/platform,\s*updated_at:/);
  assert.match(migration,/platform in \('android','ios'\)/);
  assert.match(notice,/const iosDevices=devices.filter\(d=>d.platform==='ios'\)/);
  assert.match(chat,/const iosDevices=devices.filter\(d=>d.platform==='ios'\)/);
  assert.match(notice,/sendApns\(/);
  assert.match(chat,/sendApns\(/);
});
test('Android FCM push still uses its existing platform and code path',()=>{
  assert.match(push,/platform='android'/);
  assert.match(chat,/const androidDevices=devices.filter\(d=>d.platform==='android'\)/);
  assert.match(notice,/const androidDevices=devices.filter\(d=>d.platform==='android'\)/);
});

test('iPhone setup displays requested exact text and a single configuration action',()=>{
  const start=main.indexOf('let iosSetupAcknowledged=false;');
  const end=main.indexOf('if(bridgeBootstrap&&!denied',start);
  assert.ok(start>0&&end>start);
  const intro=main.slice(start,end);
  assert.match(intro,/Collega il tuo iPhone per poter utilizzare FreePT\./);
  assert.match(intro,/FreePT ha bisogno di accedere ai tuoi file per attivare le funzionalità dell/);
  assert.match(intro,/>Avvia configurazione<\/button>/);
  assert.match(intro,/iosSetupAcknowledged=true/);
  assert.match(intro,/iosFiles\.requestPermission\(\)/);
  assert.match(intro,/permission\?\.granted!==true/);
  assert.doesNotMatch(intro,/getUserMedia\(|bridgeAllFiles\./);
});
