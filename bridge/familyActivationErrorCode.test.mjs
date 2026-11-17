import test from 'node:test';
import assert from 'node:assert/strict';
import {familyActivationErrorCode} from '../src/bridgeOwnerControls.js';
test('family activation diagnostics allow only stable SQL codes',()=>{
  for(const code of ['bridge_owner_not_approved','bridge_invalid_device','bridge_owner_required','bridge_unique_admin_required','bridge_admin_not_unique'])
    assert.equal(familyActivationErrorCode({message:code}),code);
  for(const input of [{message:'secret uuid 11111111-1111-4111-8111-111111111111'}, {message:'bridge_owner_required: leaked details'},null,{}, {message:123}])
    assert.equal(familyActivationErrorCode(input),'bridge_owner_activation_denied');
});
