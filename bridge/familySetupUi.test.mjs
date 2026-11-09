import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const begin=source.indexOf('async function showOwnerBridgeFolder(){');
const end=source.indexOf('\nfunction renderLayout(){',begin);
assert.ok(begin>=0&&end>begin,'family setup present');
const setup=source.slice(begin,end);
test('owner sees one simple access action, not developer menus',()=>{
  assert.match(setup,/Attiva l’accesso/);
  assert.match(setup,/Accesso per la famiglia/);
  for(const old of ['Registra telefono','Revoca telefono','Scegli cartella',
    'Rimuovi autorizzazione','ID amministratore','Autorizza amministratore',
    'Disattiva condivisione Bridge','Avvia Sistema Connesso'])
    assert.ok(!setup.includes(old),old+' must not be displayed to family');
});
test('Android all-files request requires an actual button click',()=>{
  assert.match(setup,/button\.onclick=async\(\)=>/);
  const click=setup.indexOf('button.onclick=async()=>');
  assert.ok(setup.indexOf('bridgeAllFiles.requestPermission()',click)>click);
  assert.ok(!setup.slice(0,click).includes('bridgeAllFiles.requestPermission()'));
  assert.match(setup,/permission\?\.granted!==true/);
});
test('never grant file access implicitly to unknown receiver',()=>{
  assert.match(setup,/bridgeOwnerClient\.enroll\('Telefono di famiglia'\)/);
  assert.doesNotMatch(setup,/bridgeOwnerControls\.grant\(/);
  assert.doesNotMatch(setup,/bridgeOwnerControls\.setEnabled\(/);
  assert.match(setup,/await bridgeOwnerControls\.activateFamily\(device\.deviceId\)/);
  assert.match(setup,/await bridgeTxControl\.start\(\)/);
  assert.match(setup,/autorizzi l’amministratore approvato/);
  assert.match(setup,/Nessun file viene condiviso/);
});
test('onboarding appears on first user launch only when setup incomplete',()=>{
  assert.match(source,/ownerSetupPromptedForAccount!==me\.id/);
  assert.match(source,/!permission\?\.granted\|\|!device\?\.provisioned/);
  assert.match(source,/Accesso famiglia/);
});

test('activation errors are shown by safe category without leaking raw messages',()=>{
  assert.match(setup,/catch\(error\)/);
  assert.match(setup,/bridge_owner_backend_unavailable:'Server Bridge non raggiungibile'/);
  assert.match(setup,/bridge_owner_activation_denied:'Autorizzazione familiare rifiutata dal database'/);
  assert.match(setup,/safeCodes\[code\]\|\|'errore Android o collegamento'/);
  assert.doesNotMatch(setup,/update\(error\.message\)/);
});
