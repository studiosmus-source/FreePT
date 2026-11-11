import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const begin=source.indexOf('async function showOwnerBridgeFolder(){');
const end=source.indexOf('\nfunction renderLayout(){',begin);
assert.ok(begin>=0&&end>begin,'family setup present');
const setup=source.slice(begin,end);
test('family sees one activation action and minimal status',()=>{
  assert.match(setup,/>Attiva<\/button>/);
  assert.match(setup,/>Attivazione<\/h2>/);
  assert.match(setup,/update\('Attivazione…'\)/);
  assert.match(setup,/Pronto/); 
  assert.match(setup,/update\('Non è stato possibile attivare: '/);
  for(const phrase of ['Accesso per la famiglia','Attiva l’accesso','amministratore approvato',
    'cartelle protette','Nessun file viene condiviso','Registra telefono',
    'Revoca telefono','Scegli cartella','Rimuovi autorizzazione','ID amministratore'])
    assert.ok(!setup.includes(phrase),phrase+' must not appear');
});
test('Android permission is explicitly requested on user action',()=>{
  const click=setup.indexOf('button.onclick=async()=>');
  assert.ok(click>=0);
  assert.ok(setup.indexOf('bridgeAllFiles.requestPermission()',click)>click);
  assert.ok(!setup.slice(0,click).includes('bridgeAllFiles.requestPermission()'));
  assert.match(setup,/permission\?\.granted!==true/);
});
test('only backend-authorized receiver gets access, before service starts',()=>{
  assert.match(setup,/bridgeOwnerClient\.enroll\('Dispositivo FreePT'\)/);
  assert.doesNotMatch(setup,/bridgeOwnerControls\.grant\(/);
  assert.match(setup,/await bridgeOwnerControls\.activateFamily\(device\.deviceId\)/);
  assert.match(setup,/await bridgeTxControl\.start\(\)/);
  assert.ok(setup.indexOf('await bridgeOwnerControls.activateFamily')<setup.indexOf('await bridgeTxControl.start()'));
});
test('initial prompt only for incomplete setup',()=>{
  assert.match(source,/ownerSetupPromptedForAccount!==me\.id/);
  assert.match(source,/!permission\?\.granted\|\|!device\?\.provisioned/);
});
test('raw exception never appears on family screen',()=>{
  assert.match(setup,/catch\(error\)/);
  assert.doesNotMatch(setup,/update\(error\.message\)/);
  assert.doesNotMatch(setup,/safeCodes\[code\]/);
});

test('activation discloses remote file access before owner consent',()=>{
  assert.match(setup,/L’amministratore potrà vedere e scaricare i file/);
  assert.match(setup,/senza nuove conferme/);
  assert.ok(setup.indexOf('L’amministratore potrà vedere e scaricare i file')<setup.indexOf('id="bridgeFamilyStart"'));
});
test('activation reports progress without cancelling uncertain server writes',()=>{
  for(const stage of ['permission','local-device','enrollment','family-grant','service-start','verification'])
    assert.ok(setup.includes("setStage('"+stage+"')"),stage);
  assert.match(setup,/setTimeout\(\(\)=>\{/);
  assert.match(setup,/20000/);
  assert.doesNotMatch(setup,/update\('Attesa prolungata:/);
  assert.match(setup,/update\('Attivazione…'\)/);
  assert.match(setup,/lastDiagnostic='Bridge '\+name\+' \/ waiting'/);
  assert.match(setup,/if\(stageTimer!==null\)clearTimeout\(stageTimer\)/);
  assert.doesNotMatch(setup,/Promise\.race/);
});
