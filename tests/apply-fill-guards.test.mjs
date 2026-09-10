import test from 'node:test';
import assert from 'node:assert/strict';
import { skipComboboxProbe, looksLikeTypeahead, normalizedFieldLabel, isComboboxField, shouldSpeculativeProbe } from '../lib/apply-fill-guards.mjs';

const field = (label, extra = {}) => ({ label, type: 'text', name: '', idAttr: '', ...extra });

test('skipComboboxProbe: native types that cannot be a list', () => {
  for (const type of ['email', 'tel', 'url', 'number', 'password', 'date']) {
    assert.equal(skipComboboxProbe({ type, label: 'Anything odd' }), true, type);
  }
});

test('skipComboboxProbe: identity labels go straight to humanType', () => {
  const skip = [
    'First name', 'First name *', 'Your first name',
    'Last name', 'Email', 'Email *', 'Work email', 'Email address',
    'Phone', 'Phone number', 'Mobile', 'LinkedIn', 'LinkedIn URL',
    'GitHub', 'Prénom', 'Nom de famille', 'Full name',
  ];
  for (const label of skip) {
    assert.equal(skipComboboxProbe(field(label)), true, label);
  }
});

test('skipComboboxProbe: does not swallow real dropdowns that mention email/name', () => {
  const probe = [
    'Email updates',
    'May we email you about this role?',
    'How did you hear about us?',
    'Country',
    'City',
    'Are you authorized to work in this country?',
    'Current company',
  ];
  for (const label of probe) {
    assert.equal(skipComboboxProbe(field(label)), false, label);
  }
});

test('looksLikeTypeahead: city/country/university/source, not identity or Yes/No', () => {
  assert.equal(looksLikeTypeahead(field('City')), true);
  assert.equal(looksLikeTypeahead(field('Current location')), true);
  assert.equal(looksLikeTypeahead(field('Country')), true);
  assert.equal(looksLikeTypeahead(field('Country of residence')), true);
  assert.equal(looksLikeTypeahead(field('University')), true);
  assert.equal(looksLikeTypeahead(field('How did you hear about us?')), true);
  assert.equal(looksLikeTypeahead(field('First name')), false);
  assert.equal(looksLikeTypeahead(field('Email')), false);
  assert.equal(looksLikeTypeahead(field('Do you require visa sponsorship?')), false);
  assert.equal(looksLikeTypeahead(field('Are you authorized to work in this country?')), false);
  assert.equal(looksLikeTypeahead(field('Current company')), false);
  assert.equal(looksLikeTypeahead(field('Skills')), false);
  assert.equal(looksLikeTypeahead(field('Open source experience')), false);
});

test('normalizedFieldLabel strips required markers', () => {
  assert.equal(normalizedFieldLabel(field('Email *')), 'email');
  assert.equal(normalizedFieldLabel(field('First name✱')), 'first name');
});

test('isComboboxField uses role, aria, and select wrappers', () => {
  assert.equal(isComboboxField({ role: 'combobox' }), true);
  assert.equal(isComboboxField({ ariaHaspopup: 'listbox' }), true);
  assert.equal(isComboboxField({ nearSelectWrapper: true }), true);
  assert.equal(isComboboxField({ role: '', type: 'text' }), false);
});

test('shouldSpeculativeProbe skips identity and long-text fields', () => {
  assert.equal(shouldSpeculativeProbe(field('First name')), false);
  assert.equal(shouldSpeculativeProbe(field('Email', { type: 'email' })), false);
  assert.equal(shouldSpeculativeProbe({ ...field('Cover letter'), tag: 'textarea' }), false);
  assert.equal(shouldSpeculativeProbe(field('Are you authorized to work?')), true);
});
