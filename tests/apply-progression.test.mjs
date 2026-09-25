import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APPLY_TEXT_RE,
  PROGRESS_TEXT_RE,
  SUBMIT_TEXT_RE,
  isBlockingApplyPending,
  fieldsFingerprint,
  pageLooksLikeReviewStep,
  reviewStepNeedsAi,
  reviewStepConfidence,
  countEditableApplyFields,
  classifyActionLabel,
  canAdvanceWizardStep,
  shouldAttemptSubmitAfterNoopNext,
  submitChoice,
  progressionButtonVisible,
  forwardProgressVisible,
} from '../lib/apply-progression.mjs';
import { AUTH_AVOID_TEXT_RE } from '../lib/form-detect.mjs';

test('PROGRESS_TEXT_RE covers multi-step Next / Continue variants', () => {
  const yes = [
    'Next', 'Next step', 'Next page', 'Next >',
    'Continue', 'Continue to questions', 'Continue application',
    'Save & Continue', 'Save and continue', 'Save and Next',
    'Get started', 'Start application', 'Begin application',
    'Proceed', 'Go to next step', 'Go to application',
    'Review', 'Review application', 'Review your application', 'Review and continue',
    'Review details', 'Review answers', 'Save and review', 'Save & review',
    'Continue to review', 'Continue to confirmation', 'Preview application',
    'Verify information', 'Confirm details', 'Check your answers',
    'Suivant', 'Étape suivante', 'Continuer', 'Passer à la suite',
    'Weiter', 'Siguiente', 'Avanti', 'Próximo',
  ];
  for (const t of yes) {
    assert.equal(PROGRESS_TEXT_RE.test(t), true, `should match: ${t}`);
  }
});

test('PROGRESS_TEXT_RE does not steal final Submit labels', () => {
  for (const t of [
    'Submit', 'Submit application', 'Review and submit', 'Send application', 'Finish',
    'Confirm and submit', 'Confirm application', 'Verify and submit', 'Complete application',
    'Review & Submit',
  ]) {
    assert.equal(PROGRESS_TEXT_RE.test(t), false, `must not match submit: ${t}`);
    assert.equal(SUBMIT_TEXT_RE.test(t), true, `submit should match: ${t}`);
  }
});

test('pageLooksLikeReviewStep detects verification / summary screens', () => {
  assert.equal(pageLooksLikeReviewStep({
    heading: 'Review your application',
    bodySnippet: 'Please confirm the details below',
    fieldCount: 1,
    editableCount: 0,
  }), true);
  assert.equal(pageLooksLikeReviewStep({
    heading: 'Verify your information',
    bodySnippet: 'Almost done',
    fieldCount: 2,
    editableCount: 0,
  }), true);
  assert.equal(pageLooksLikeReviewStep({
    heading: 'Personal information',
    bodySnippet: 'First name Last name Email',
    fieldCount: 8,
    editableCount: 6,
  }), false);
});

test('reviewStepNeedsAi only when the heuristic missed a summary-like page', () => {
  assert.equal(reviewStepNeedsAi({
    heading: 'Application summary',
    bodySnippet: 'Please check',
    fieldCount: 1,
    editableCount: 1,
  }), true);
  assert.equal(reviewStepNeedsAi({
    heading: 'Review your application',
    bodySnippet: '',
    fieldCount: 0,
    editableCount: 0,
  }), false);
  assert.equal(reviewStepNeedsAi({
    heading: 'Contact',
    bodySnippet: 'By submitting you confirm the privacy policy and your email address',
    fieldCount: 6,
    editableCount: 4,
  }), false);
});

test('countEditableApplyFields ignores checkboxes and files', () => {
  assert.equal(countEditableApplyFields([
    { type: 'text', label: 'Name' },
    { type: 'checkbox', label: 'Privacy' },
    { type: 'file', label: 'Resume' },
  ]), 1);
});

test('AUTH_AVOID still vetoes Continue with Google / Sign in', () => {
  assert.equal(PROGRESS_TEXT_RE.test('Continue with Google'), true);
  assert.equal(AUTH_AVOID_TEXT_RE.test('Continue with Google'), true);
  assert.equal(AUTH_AVOID_TEXT_RE.test('Sign in'), true);
  assert.equal(PROGRESS_TEXT_RE.test('Next'), true);
  assert.equal(AUTH_AVOID_TEXT_RE.test('Next'), false);
});

test('APPLY_TEXT_RE still matches Apply CTAs', () => {
  assert.equal(APPLY_TEXT_RE.test('Apply now'), true);
  assert.equal(APPLY_TEXT_RE.test('Easy Apply'), true);
  assert.equal(APPLY_TEXT_RE.test('Postuler'), true);
});

test('isBlockingApplyPending catches CV / required / combobox misses', () => {
  assert.equal(isBlockingApplyPending('CV manquant'), true);
  assert.equal(isBlockingApplyPending('fichier requis manquant'), true);
  assert.equal(isBlockingApplyPending('upload échoué: not found'), true);
  assert.equal(isBlockingApplyPending('no matching option for "Yes"'), true);
  assert.equal(isBlockingApplyPending('requis et vide'), true);
  assert.equal(isBlockingApplyPending('requis — pas de donnée profil (à remplir manuellement)'), false);
  assert.equal(isBlockingApplyPending('code postal non renseigné dans le profil'), false);
  assert.equal(isBlockingApplyPending('optionnel linkedin'), false);
});

test('fieldsFingerprint changes when wizard step fields change', () => {
  const a = fieldsFingerprint([
    { type: 'text', label: 'First name', name: 'first', required: true },
    { type: 'email', label: 'Email', name: 'email', required: true },
  ]);
  const b = fieldsFingerprint([
    { type: 'text', label: 'Years of experience', name: 'yoe', required: true },
    { type: 'select', label: 'Country', name: 'country', required: true },
  ]);
  assert.notEqual(a, b);
  assert.equal(a, fieldsFingerprint([
    { type: 'text', label: 'First name', name: 'first', required: true },
    { type: 'email', label: 'Email', name: 'email', required: true },
  ]));
  assert.notEqual(a, fieldsFingerprint([
    { type: 'text', label: 'First name', name: 'first', required: true },
    { type: 'email', label: 'Email', name: 'email', required: true },
  ], { url: 'https://jobs.example/apply/2', heading: 'Experience' }));
});

test('fieldsFingerprint ignores DOM ids, CSRF, query tokens, and field order', () => {
  const base = [
    { type: 'email', label: 'Email *', name: 'email', idAttr: 'f-1', i: 3, value: 'a@b.com' },
    { type: 'text', label: 'First name', name: 'first', idAttr: 'dyn-99', value: 'Ada' },
  ];
  const reordered = [
    { type: 'hidden', label: '', name: 'csrf_token', value: 'tok-1' },
    { type: 'text', label: 'First name', name: 'first', idAttr: 'dyn-100', value: 'Ada' },
    { type: 'email', label: 'Email required', name: 'email', idAttr: 'f-2', i: 9, value: 'a@b.com' },
  ];
  const urlA = 'https://jobs.example/apply?csrf=aaa&ts=1';
  const urlB = 'https://jobs.example/apply?csrf=bbb&ts=2#focus';
  assert.equal(fieldsFingerprint(base, { url: urlA }), fieldsFingerprint(reordered, { url: urlB }));
});

test('fieldsFingerprint tracks value, checked, options text, file, and invalid', () => {
  const text = (value, invalid = false) => fieldsFingerprint([
    { type: 'text', label: 'City', name: 'city', value, invalid },
  ]);
  assert.notEqual(text('Paris'), text('Lyon'));
  assert.notEqual(text('Paris', false), text('Paris', true));
  assert.notEqual(
    fieldsFingerprint([{ type: 'checkbox', label: 'Privacy', name: 'p', checked: false }]),
    fieldsFingerprint([{ type: 'checkbox', label: 'Privacy', name: 'p', checked: true }]),
  );
  assert.equal(
    fieldsFingerprint([{ type: 'select', label: 'Work auth', name: 'auth', options: [{ text: 'Yes', value: '1' }, { text: 'No', value: '2' }] }]),
    fieldsFingerprint([{ type: 'select', label: 'Work auth', name: 'auth', options: [{ text: 'No', value: '99' }, { text: 'Yes', value: '1' }] }]),
  );
  assert.notEqual(
    fieldsFingerprint([{ type: 'file', label: 'Resume', name: 'cv', fileCount: 0 }]),
    fieldsFingerprint([{ type: 'file', label: 'Resume', name: 'cv', fileCount: 1, fileChip: 'cv.pdf' }]),
  );
});

test('classifyActionLabel separates review navigation from submit', () => {
  const kind = (label) => classifyActionLabel(label).kind;
  const auto = (label) => classifyActionLabel(label).autoSubmit;
  for (const label of [
    'Submit', 'Submit application', 'Send application', 'Confirm and submit',
    'Review and submit', 'Review & Submit', 'Finaliser',
  ]) {
    assert.equal(kind(label), 'submit', label);
    assert.equal(auto(label), true, label);
  }
  for (const label of [
    'Review', 'Review application', 'Review your application', 'Review details',
    'Review answers', 'Save and review', 'Preview application', 'Verify information',
    'Confirm details',
  ]) {
    assert.equal(kind(label), 'review-nav', label);
    assert.equal(auto(label), false, label);
  }
  assert.equal(kind('Confirm application'), 'ambiguous');
  assert.equal(auto('Confirm application'), false);
  assert.equal(kind('Next'), 'progress');
  assert.equal(kind('Continue'), 'progress');
  assert.equal(submitChoice(['Confirm application']).allow, false);
  assert.equal(submitChoice(['Submit application']).allow, true);
  assert.equal(submitChoice(['Next', 'Submit', 'Confirm application']).allow, true);
  assert.equal(submitChoice(['Finish', 'Confirm application']).allow, false);
  assert.equal(progressionButtonVisible(['Review application']), true);
  assert.equal(forwardProgressVisible(['Review application']), false);
  assert.equal(forwardProgressVisible(['Continue']), true);
  assert.equal(progressionButtonVisible(['Submit application']), false);
});

test('canAdvanceWizardStep allows pages with nothing to fill', () => {
  const intro = {
    hardBlock: false,
    isReview: false,
    requiredEmpty: false,
    nextVisible: true,
    nextVisibilityKnown: true,
    previousClickNoEffect: false,
  };
  assert.equal(canAdvanceWizardStep(intro), true);
  assert.equal(canAdvanceWizardStep({ ...intro, requiredEmpty: true }), false);
  assert.equal(canAdvanceWizardStep({ ...intro, hardBlock: true }), false);
  assert.equal(canAdvanceWizardStep({ ...intro, isReview: true }), false);
  assert.equal(canAdvanceWizardStep({ ...intro, nextVisible: false }), false);
  assert.equal(canAdvanceWizardStep({ ...intro, previousClickNoEffect: true }), false);
  assert.equal(canAdvanceWizardStep({ ...intro, nextVisible: false, nextVisibilityKnown: false }), true);
});

test('shouldAttemptSubmitAfterNoopNext does not send after a failed Next', () => {
  assert.equal(shouldAttemptSubmitAfterNoopNext({
    submitButtonVisible: true,
    progressStillVisible: true,
    reviewConfidence: 'none',
    requiredEmpty: false,
  }), false);
  assert.equal(shouldAttemptSubmitAfterNoopNext({
    submitButtonVisible: true,
    progressStillVisible: false,
    reviewConfidence: 'none',
    requiredEmpty: false,
  }), true);
  assert.equal(shouldAttemptSubmitAfterNoopNext({
    submitButtonVisible: true,
    reviewConfidence: 'high',
    requiredEmpty: true,
  }), false);
  assert.equal(shouldAttemptSubmitAfterNoopNext({
    submitButtonVisible: false,
    progressStillVisible: false,
    reviewConfidence: 'high',
    requiredEmpty: false,
  }), true);
  assert.equal(shouldAttemptSubmitAfterNoopNext({
    submitButtonVisible: false,
    progressStillVisible: false,
    reviewConfidence: 'low',
  }), false);
});

test('reviewStepConfidence is high only from the heading', () => {
  assert.equal(reviewStepConfidence({
    heading: 'Review your application',
    bodySnippet: 'Please confirm the details below',
  }), 'high');
  assert.equal(reviewStepConfidence({
    heading: 'Before you continue',
    bodySnippet: 'You can review your application later',
    fieldCount: 6,
    editableCount: 4,
  }), 'low');
  assert.equal(reviewStepConfidence({
    heading: 'Personal information',
    bodySnippet: 'First name Last name Email',
    fieldCount: 8,
    editableCount: 6,
  }), 'none');
});
