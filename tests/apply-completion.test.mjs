import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldCompletionIssue, looksReadyToSubmit } from '../lib/apply-completion.mjs';

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

test('already-uploaded resume is not pending just because the ATS cloned the input', () => {
  const f = { type: 'file', required: true, fileCount: 0, label: 'Resume', name: 'resume' };
  assert.equal(fieldCompletionIssue(f), 'fichier requis manquant');
  assert.equal(fieldCompletionIssue(f, { uploadedLabels: ['Resume'] }), null);
});

test('looksReadyToSubmit: Apply-for-this-job or missing email blocks auto-send', () => {
  assert.equal(looksReadyToSubmit({
    filled: [{ label: 'Resume', value: '📎 cv.pdf' }],
    pending: [],
    applyEntryVisible: true,
  }), false);
  assert.equal(looksReadyToSubmit({
    filled: [{ label: 'Resume', value: '📎 cv.pdf' }],
    pending: [],
    applyEntryVisible: false,
  }), false);
  assert.equal(looksReadyToSubmit({
    filled: [
      { label: 'Email', value: 'hugo@example.com' },
      { label: 'Resume', value: '📎 cv.pdf' },
    ],
    pending: [],
    applyEntryVisible: false,
  }), true);
});

test('optional empty fields are not completion blockers', () => {
  assert.equal(fieldCompletionIssue({ type: 'url', required: false, value: '', invalid: false }), null);
  assert.equal(fieldCompletionIssue({ type: 'text', required: false, value: '', label: 'LinkedIn Profile' }), null);
});

test('optional invalid values are reported while optional empty fields are allowed', () => {
  assert.ok(fieldCompletionIssue({ type: 'email', required: false, value: 'broken', invalid: true }));
  assert.equal(fieldCompletionIssue({ type: 'email', required: false, value: '', invalid: false }), null);
});
