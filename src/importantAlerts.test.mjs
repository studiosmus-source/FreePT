import test from 'node:test';
import assert from 'node:assert/strict';
import {validateImportantAlert} from './importantAlerts.js';
test('admin can send arbitrary personal text with no fixed recipient heading',()=>{
  assert.deepEqual(validateImportantAlert({title:'',body:'  Controlla il file  '}),{title:'',body:'Controlla il file'});
  assert.deepEqual(validateImportantAlert({title:'Promemoria',body:'  Ci vediamo alle 18.  '}),{title:'Promemoria',body:'Ci vediamo alle 18.'});
});
test('empty messages cannot be sent',()=>{
  assert.throws(()=>validateImportantAlert({title:'Promemoria',body:'    '}),/Scrivi un messaggio/);
});
test('oversized payloads are refused',()=>{
  assert.throws(()=>validateImportantAlert({title:'a'.repeat(121),body:'ok'}),/Titolo troppo lungo/);
  assert.throws(()=>validateImportantAlert({body:'a'.repeat(751)}),/massimo 750/);
});
test('input values are coerced to safe strings and trimmed',()=>{
  assert.deepEqual(validateImportantAlert({title:123,body:' Ciao\nRita '}),{title:'123',body:'Ciao\nRita'});
});
