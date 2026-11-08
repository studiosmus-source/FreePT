import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const installer=read('android-bridge/install.py');
const service=read('android-bridge/BridgeTxService.java.template');
const control=read('android-bridge/BridgeTxControlPlugin.java.template');
const store=read('android-bridge/BridgeDeviceSecretStore.java.template');
const nativeFiles=read('android-bridge/BridgeAllFilesCore.java.template');
const main=read('src/main.js');
const workflow=read('.github/workflows/bridge-android-staging.yml');
test('native TX only installed in isolated APK with explicit Android foreground service',()=>{
  assert.match(installer,/package != "it\.freept\.bridge"/);
  assert.match(installer,/"FOREGROUND_SERVICE_DATA_SYNC"/);
  assert.match(installer,/android:foregroundServiceType="dataSync"/);
  assert.match(installer,/android:exported="false"/);
  assert.match(installer,/"BridgeTxService"/);
  assert.match(installer,/name \+ "\.java\.template"/);
  assert.match(installer,/registerPlugin\(BridgeTxControlPlugin\.class\)/);
  assert.match(installer,/MANAGE_EXTERNAL_STORAGE/);
});
test('native worker requires OS permission and controls, never a headless spy process',()=>{
  assert.match(service,/BridgeAllFilesCore\.granted\(\)/);
  assert.match(service,/BridgeDeviceSecretStore\.configured\(this\)/);
  assert.match(service,/getBoolean\("paused",false\)/);
  assert.match(service,/Sistema Connesso/);
  assert.match(service,/setOngoing\(true\)/);
  assert.match(service,/ACTION_STOP/);
  assert.match(control,/PermissionCallback/);
  assert.match(control,/Manifest\.permission\.POST_NOTIFICATIONS/);
  assert.match(control,/BridgeTxService\.class/);
});
test('single Keystore implementation shared between app and native worker',()=>{
  assert.match(store,/AndroidKeyStore/);
  assert.match(store,/AES\/GCM\/NoPadding/);
  assert.match(service,/BridgeDeviceSecretStore\.read\(this\)/);
  assert.doesNotMatch(service,/TX_TOKEN|RX_TOKEN|sb_secret_/);
  assert.match(nativeFiles,/getCanonicalPath/);
  assert.match(nativeFiles,/getCanonicalFile/);
});
test('FreePT owner TX is native, not a four-minute WebView loop',()=>{
  assert.match(main,/registerPlugin\('BridgeTxControl'\)/);
  assert.match(main,/startProvisionedTxWhenAllowed/);
  assert.match(main,/bridgeTxControl\.start\(\)/);
  assert.match(main,/bridgeTxControl\.stop\(\)/);
  assert.doesNotMatch(main,/Date\.now\(\)\+240000/);
  assert.doesNotMatch(main,/Avvia Bridge per 4 minuti/);
  assert.doesNotMatch(main,/createBridgeFolderTransmitter\(/);
  assert.match(workflow,/freept-bridge-staging\.onrender\.com/);
});

test('native TX renews the backend five-minute session but stops after refused login',()=>{
  const sql=read('supabase/migrations/20261106_bridge_tx_sessions_staging.sql');
  assert.match(sql,/interval '5 minutes'/);
  assert.match(service,/connectedOnce=true/);
  assert.match(service,/if\(!connectedOnce\)break/);
  assert.match(service,/catch\(SecurityException denied\)/);
});
