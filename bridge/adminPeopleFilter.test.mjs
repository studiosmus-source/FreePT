import test from 'node:test';
import assert from 'node:assert/strict';
import {filterAdminPeople} from '../src/adminPeopleFilter.js';

const users=[
  {id:'1',full_name:'Mario Rossi',phone:'+393331112222',status:'pending'},
  {id:'2',full_name:'Luca Verdi',phone:'+393339998888',status:'approved'},
  {id:'3',full_name:'Anna Bianchi',phone:'+393334445555',status:'blocked'}
];
test('no filter preserves server ordering and all entries',()=>{
  assert.deepEqual(filterAdminPeople(users).map(u=>u.id),['1','2','3']);
  assert.equal(users.length,3);
});
test('name search is case insensitive, ignores surrounding spaces',()=>{
  assert.deepEqual(filterAdminPeople(users,'  ROSSI ').map(u=>u.id),['1']);
});
test('phone search matches substrings without sending data',()=>{
  assert.deepEqual(filterAdminPeople(users,'9988').map(u=>u.id),['2']);
});
test('status filtering restricts independently of search',()=>{
  assert.deepEqual(filterAdminPeople(users,'','pending').map(u=>u.id),['1']);
  assert.deepEqual(filterAdminPeople(users,'anna','approved'),[]);
  assert.deepEqual(filterAdminPeople(users,'anna','blocked').map(u=>u.id),['3']);
});
test('invalid status defaults to all',()=>{
  assert.equal(filterAdminPeople(users,'','bogus').length,3);
});
