import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldCompletionIssue } from '../lib/apply-completion.mjs';

test('an explicit ATS error on a selected choice remains pending', () => {
  assert.equal(fieldCompletionIssue({
    type: 'checkbox', required: true, groupChecked: true,
    invalid: true, ariaInvalid: true, validationMessage: 'Choose at most two options',
  }), 'Choose at most two options');
});

test('a selected group clears native missing-value errors on unselected siblings', () => {
  assert.equal(fieldCompletionIssue({
    type: 'checkbox', required: true, groupChecked: true,
    invalid: true, ariaInvalid: false,
  }), null);
});

test('optional invalid values are reported while optional empty fields are allowed', () => {
  assert.ok(fieldCompletionIssue({ type: 'email', required: false, value: 'broken', invalid: true }));
  assert.equal(fieldCompletionIssue({ type: 'email', required: false, value: '', invalid: false }), null);
});
