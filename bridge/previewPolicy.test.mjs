import test from 'node:test';
import assert from 'node:assert/strict';
import {bridgePreviewPolicy as policy,IMAGE_PREVIEW_LIMIT,PDF_PREVIEW_LIMIT} from '../src/bridgePreviewPolicy.js';
const item=(name,mime,size=512)=>({name,mime,size,directory:false});
test('generic Android MIME resolves only allowlisted extensions, case insensitive',()=>{
  assert.equal(policy(item('PHOTO.JPEG','application/octet-stream')).mime,'image/jpeg');
  assert.equal(policy(item('report.PDF','')).kind,'pdf');
  assert.equal(policy(item('name.txt','text/plain; charset=utf-8')).kind,'text');
  assert.equal(policy(item('photo.jpg','application/x-unknown')),null);
});
test('media and text previews include common types but never executable HTML or SVG',()=>{
  for(const [name,mime,kind] of [
    ['a.mp4','video/mp4','video'],['a.mp3','audio/mpeg','audio'],
    ['a.json','application/json','text'],['a.xml','application/xml','text']
  ])assert.equal(policy(item(name,mime)).kind,kind);
  for(const [name,mime] of [['a.svg','image/svg+xml'],['a.html','text/html'],['a.apk','application/vnd.android.package-archive'],['a.zip','application/zip']])
    assert.equal(policy(item(name,mime)),null);
});
test('large JPEGs offer embedded-only previews; other preview allocations remain bounded',()=>{
  assert.equal(policy(item('a.jpg','image/jpeg',IMAGE_PREVIEW_LIMIT)).embeddedOnly,false);
  assert.equal(policy(item('a.jpg','image/jpeg',IMAGE_PREVIEW_LIMIT+1)).embeddedOnly,true);
  assert.equal(policy(item('a.png','image/png',IMAGE_PREVIEW_LIMIT+1)),null);
  assert.equal(policy(item('a.pdf','application/pdf',PDF_PREVIEW_LIMIT+1)),null);
  assert.equal(policy(item('a.mp4','video/mp4',IMAGE_PREVIEW_LIMIT+1)),null);
});
test('directories, empty files and unknown lengths remain download-only',()=>{
  for(const size of [-1,0,NaN,Infinity,1.5])assert.equal(policy(item('a.jpg','image/jpeg',size)),null);
  assert.equal(policy({...item('a.jpg','image/jpeg'),directory:true}),null);
});
