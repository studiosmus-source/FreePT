import test from 'node:test';
import assert from 'node:assert/strict';
import {attachmentExtension,attachmentKind,attachmentMime} from './chatAttachments.js';
test('extension parsing',()=>{
  assert.equal(attachmentExtension('foto.JPG'),'jpg');
  assert.equal(attachmentExtension('senza'),'');
  assert.equal(attachmentExtension('a.tar.gz'),'gz');
  assert.equal(attachmentExtension('punto.'),'');
});
test('kind classification',()=>{
  assert.equal(attachmentKind('a.png'),'image');
  assert.equal(attachmentKind('a.HEIC'),'image');
  assert.equal(attachmentKind('a.mp4'),'video');
  assert.equal(attachmentKind('a.mp3'),'audio');
  assert.equal(attachmentKind('a.pdf'),'pdf');
  assert.equal(attachmentKind('a.docx'),'other');
  assert.equal(attachmentKind('noext'),'other');
});
test('mime mapping',()=>{
  assert.equal(attachmentMime('a.jpg'),'image/jpeg');
  assert.equal(attachmentMime('a.mp4'),'video/mp4');
  assert.equal(attachmentMime('a.pdf'),'application/pdf');
  assert.equal(attachmentMime('a.bin'),'application/octet-stream');
});
