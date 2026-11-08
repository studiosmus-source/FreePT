import test from 'node:test';
import assert from 'node:assert/strict';
import {getAdminStatusAction} from '../src/adminStatusAction.js';

test('approved user can be suspended without deletion',()=>{
  const action=getAdminStatusAction('approved');
  assert.equal(action.next,'blocked');
  assert.match(action.label,/Sospendi/);
});
test('blocked user can be reactivated',()=>{
  const action=getAdminStatusAction('blocked');
  assert.equal(action.next,'approved');
  assert.match(action.label,/Riattiva/);
});
test('pending, admin and unknown statuses do not get action',()=>{
  assert.equal(getAdminStatusAction('pending'),null);
  assert.equal(getAdminStatusAction('admin'),null);
  assert.equal(getAdminStatusAction(undefined),null);
});
test('actions cannot be mutated at runtime',()=>{
  assert.equal(Object.isFrozen(getAdminStatusAction('approved')),true);
});
