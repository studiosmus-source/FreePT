import test from 'node:test';
import assert from 'node:assert/strict';
import {validateImportantAlert,validateAlertApkAttachment} from './importantAlerts.js';
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

test('verified APK attachment is bound to this repository release and checksum',()=>{
 const apk={url:'https://github.com/studiosmus-source/FreePT/releases/download/test-v2.4.0/FreePT-TEST.apk',
  sha256:'A'.repeat(64),versionCode:15,versionName:'2.4.0'};
 assert.deepEqual(validateImportantAlert({title:'Aggiornamento',body:'Aggiorna FreePT',apk}).apk,
  {...apk,sha256:'a'.repeat(64)});
});
test('malicious APK attachments and fake versions are rejected',()=>{
 const good={url:'https://github.com/studiosmus-source/FreePT/releases/download/test-v2.4.0/FreePT-TEST.apk',
  sha256:'a'.repeat(64),versionCode:15,versionName:'2.4.0'};
 for(const invalid of [
  {...good,url:'https://example.org/malicious.apk'},
  {...good,url:good.url+'?token=secret'},
  {...good,sha256:'missing'},
  {...good,versionCode:0},
  {...good,versionCode:1.5},
  {...good,versionName:'../../bad'},
  'https://example.org/malicious.apk'
 ])assert.throws(()=>validateAlertApkAttachment(invalid),/Allegato APK/);
});
