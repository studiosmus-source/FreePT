import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('admin session unlock does not depend on biometric hardware',()=>{
 const main=read('src/main.js');
 assert.doesNotMatch(main,/NativeBiometric|verifyIdentity|Sblocca con impronta/);
 assert.match(main,/profile\?\.role==='admin'&&profile\?\.status==='approved'/);
 assert.match(main,/mountAdminChatShareActions\(feed\)/);
 assert.match(main,/if\(profile\?\.role!=='admin'\|\|profile\?\.status!=='approved'\|\|!adminUnlocked/);
});
test('admin-only message copy has no sharing endpoint or biometric promise',()=>{
 const main=read('src/main.js');
 assert.match(main,/button\('Copia'/);
 assert.doesNotMatch(main,/shareAdminChatText|shareAdminChatAttachment|Condividi testo|Condividi file|impronta/);
 assert.doesNotMatch(read('src/adminOtpAuth.js'),/impronta/);
 const native=read('android-bridge/FreePTAdminSharePlugin.java.template');
 assert.match(native,/setPrimaryClip/);
 assert.doesNotMatch(native,/ACTION_SEND|shareText|shareFile|HttpURLConnection|getUriForFile/);
 const installer=read('android-bridge/install.py');
 assert.match(installer,/registerPlugin\(FreePTAdminSharePlugin\.class\)/);
 assert.doesNotMatch(installer,/freept_chat_share/);
 assert.match(installer,/freept_updates/);
});
