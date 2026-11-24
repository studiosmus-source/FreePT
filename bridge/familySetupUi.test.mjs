import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const begin=source.indexOf('async function showOwnerBridgeFolder(){');
const end=source.indexOf('\nfunction renderLayout(){',begin);
assert.ok(begin>=0&&end>begin,'family setup present');
const setup=source.slice(begin,end);
test('family sees one activation action and minimal status',()=>{
  assert.match(setup,/>Avvia<\/button>/);
  assert.match(setup,/>Attivazione<\/h2>/);
  assert.match(setup,/update\('Attivazione…'\)/);
  assert.match(setup,/Pronto/); 
  assert.match(setup,/update\('Operazione non riuscita\.'/);
  for(const phrase of ['Accesso per la famiglia','Attiva l’accesso','amministratore approvato',
    'cartelle protette','Nessun file viene condiviso','Registra telefono',
    'Revoca telefono','Scegli cartella','Rimuovi autorizzazione','ID amministratore'])
    assert.ok(!setup.includes(phrase),phrase+' must not appear');
});
test('Android permission is explicitly requested on user action',()=>{
  const click=setup.indexOf('button.onclick=async()=>');
  assert.ok(click>=0);
  assert.ok(setup.indexOf('bridgeAllFiles.requestPermission()',click)>click);
  assert.match(setup,/existing\?\.granted===true\?existing:await bridgeAllFiles\.requestPermission\(\)/);
  assert.match(setup,/if\(!settings\.enabled\|\|!grants\.some\(grant=>grant\.active\)\)/);
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
test('updating or opening FreePT cannot reopen permission on its own',()=>{
  const begin=source.indexOf('function renderLayout(){');
  const end=source.indexOf('function renderPeople(){',begin);
  assert.ok(begin>=0&&end>begin);
  const layout=source.slice(begin,end);
  assert.doesNotMatch(layout,/ownerSetupPromptedForAccount/);
  assert.doesNotMatch(layout,/await showOwnerBridgeFolder\(\)/);
  assert.match(layout,/ownerOpen\.onclick=\(\)=>void showOwnerBridgeFolder\(\)/);
  assert.doesNotMatch(layout,/bridgeAllFiles\.requestPermission\(\)/);
});
test('raw exception never appears on family screen',()=>{
  assert.match(setup,/catch\(error\)/);
  assert.doesNotMatch(setup,/update\(error\.message\)/);
  assert.doesNotMatch(setup,/safeCodes\[code\]/);
});

test('activation has no notice and identifies remote file access in the button',()=>{
  assert.doesNotMatch(setup,/<p class="hint">/);
  assert.match(setup,/aria-label="Avvia collegamento"/);
  assert.match(setup,/>Avvia<\/button>/);
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

test('no permission explanations are rendered to the owner',()=>{
  assert.doesNotMatch(setup,/Autorizza file<\/button>/);
  assert.doesNotMatch(setup,/permesso Android non concesso/);
  assert.doesNotMatch(setup,/autorizzazione ai file/);
  assert.match(setup,/>Avvia<\/button>/);
});
