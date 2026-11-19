import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('admin session unlock does not depend on biometric hardware',()=>{
 const main=read('src/main.js');
 assert.doesNotMatch(main,/NativeBiometric|verifyIdentity|Sblocca con impronta/);
 assert.match(main,/profile\?\.role==='admin'&&profile\?\.status==='approved'/);
 assert.match(main,/mountAdminChatShareActions\(feed\)/);
 assert.match(main,/if\(profile\?\.role!=='admin'\|\|!adminUnlocked/);
});
test('admin-only message copy/share is explicit, including native file sharing',()=>{
 const main=read('src/main.js');
 assert.match(main,/button\('Copia testo'/);
 assert.match(main,/button\('Condividi testo'/);
 assert.match(main,/button\('Condividi file'/);
 const native=read('android-bridge/FreePTAdminSharePlugin.java.template');
 assert.match(native,/Intent\.ACTION_SEND/);
 assert.match(native,/getUriForFile/);
 assert.match(native,/FLAG_GRANT_READ_URI_PERMISSION/);
 assert.match(native,/MAX_FILE_BYTES=25L\*1024L\*1024L/);
 assert.match(native,/getPath\(\)\.startsWith\("\/storage\/v1\/object\/sign\/attachments\/"\)/);
 const installer=read('android-bridge/install.py');
 assert.match(installer,/registerPlugin\(FreePTAdminSharePlugin\.class\)/);
 assert.match(installer,/freept_chat_share/);
});
