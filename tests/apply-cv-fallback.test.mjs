import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyField } from '../lib/apply-classify.mjs';
import { fileUploadPlan, isResumeFileField, isGenericDocumentSlot, cvFallbackFor, isContactConsent, shouldFillField } from '../lib/apply-fill-guards.mjs';

const spec = { cvPath: 'C:/cv/Hugo_Vermot_CV.pdf', identity: { email: 'a@b.co' }, screening: {} };
const file = label => ({ type: 'file', tag: 'input', label });
const consent = (label, required = false) => ({ type: 'checkbox', tag: 'input', label, required });

test('AssessFirst/Teamtailor "Additional files" is a generic slot, not a resume slot', () => {
  for (const label of ['Additional files Drop your file or upload', 'Additional files']) {
    assert.equal(isResumeFileField(file(label)), false);
    assert.equal(isGenericDocumentSlot(file(label)), true);
  }
});

test('with no dedicated CV slot the CV goes into the generic documents slot', () => {
  const slots = [file('Additional files Drop your file or upload'), file('Additional files')];
  const first = slots[0];
  assert.equal(cvFallbackFor(first, slots, { spec }), true);
  assert.deepEqual(fileUploadPlan(first, { ...spec, cvFallbackSlot: true }), { upload: spec.cvPath, kind: 'cv-fallback' });
  assert.deepEqual(classifyField(first, { ...spec, cvFallbackSlot: true }, new Set()), { upload: spec.cvPath, kind: 'cv-fallback' });
});

test('the fallback is off when a dedicated CV slot exists, when the CV is attached, or when no CV is configured', () => {
  const generic = file('Additional files');
  assert.equal(cvFallbackFor(generic, [file('Resume'), generic], { spec }), false);
  assert.equal(cvFallbackFor(generic, [generic], { spec, resumeAlreadyUploaded: true }), false);
  assert.equal(cvFallbackFor(generic, [generic], { spec: {} }), false);
  assert.equal(fileUploadPlan(generic, spec).skip !== undefined, true);
});

test('references, transcripts, portfolios, cover letters and IDs never receive the CV through the fallback', () => {
  for (const label of ['Reference letter', 'Transcript', 'Portfolio files', 'Cover letter', 'ID card scan', 'Diploma']) {
    assert.equal(isGenericDocumentSlot(file(label)), false, label);
    assert.equal(cvFallbackFor(file(label), [file(label)], { spec }), false, label);
  }
});

test('a dedicated Resume slot is still filled normally', () => {
  assert.deepEqual(fileUploadPlan(file('Resume'), spec), { upload: spec.cvPath });
});

test('SMS / phone / contact consents are never ticked, required or not', () => {
  const labels = [
    'Yes, AssessFirst can contact me about my application and future job offers by email',
    'Yes, AssessFirst can use my phone number to contact me by SMS',
    'Subscribe to our newsletter',
  ];
  for (const label of labels) for (const required of [false, true]) {
    const f = consent(label, required);
    assert.equal(isContactConsent(f), true, label);
    assert.equal(shouldFillField(f), false, label);
    const plan = classifyField(f, spec, new Set());
    assert.ok(plan.skip, label);
    assert.notEqual(plan.value, true);
  }
});

test('the application privacy consent is not caught by the contact-consent guard', () => {
  const f = consent('I have read the privacy policy and agree to the terms of use', true);
  assert.equal(isContactConsent(f), false);
  assert.equal(shouldFillField(f), true);
});

test('both fill paths wire the fallback and block a send when a generic slot has no CV', () => {
  const bridge = readFileSync(new URL('../extension/apply-bridge-lib.mjs', import.meta.url), 'utf8');
  const runner = readFileSync(new URL('../apply-runner.mjs', import.meta.url), 'utf8');
  for (const src of [bridge, runner]) {
    assert.match(src, /cvFallbackFor\(todo, fileFields/);
    assert.match(src, /cvFallbackSlot: true/);
  }
  assert.match(bridge, /isGenericDocumentSlot\(f\) && !Number\(f\.fileCount\)/);
  assert.match(runner, /spec\.cvPath && isGenericDocumentSlot\(todo\)/);
});
