import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const java=readFileSync(new URL('../android-bridge/BridgeFilesPlugin.java.template',import.meta.url),'utf8');
test('SAF folder handles persist across repeated listing within selected tree',()=>{
 assert.match(java,/documentHandles\.get\(docId\)/);
 assert.match(java,/documentHandles\.put\(docId,handle\)/);
 assert.match(java,/documentHandles\.clear\(\)/);
 assert.doesNotMatch(java,/if\(handles\.size\(\) >= MAX_HANDLES\) \{\s*setTree\(tree\)/);
});
test('SAF folder page has exact 100-entry boundary and a stable continuation',()=>{
 assert.match(java,/if\(emitted >= PAGE_SIZE\) \{more = true;break;\}/);
 assert.match(java,/emitted\+\+;/);
 assert.match(java,/nextOffset",more \? index \+ emitted : -1/);
});
test('SAF request refuses unknown handles rather than reaching unrestricted paths',()=>{
 assert.match(java,/handles\.get\(token\)/);
 assert.match(java,/handles\.get\(call\.getString\("handle"\)\)/);
 assert.doesNotMatch(java,/MANAGE_EXTERNAL_STORAGE/);
});

test('SAF file chunk accumulates short blocking channel reads until requested length or EOF',()=>{
 assert.match(java,/while\(bytes\.hasRemaining\(\)\)/);
 assert.match(java,/int count = channel\.read\(bytes\);/);
 assert.match(java,/if\(count < 0\) break;/);
 assert.match(java,/bridge_file_no_read_progress/);
 assert.match(java,/total \+= count;/);
 assert.match(java,/response\.put\("eof",total < length\)/);
 assert.doesNotMatch(java,/int count = channel\.read\(bytes\);\s*bytes\.flip\(\);/);
});
