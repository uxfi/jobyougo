// lib/scan-decision.mjs: an attendance word rejects only where it binds
// (2026-10-17 audit: Synthesia, Pennylane and Bjak were dropped on a word
// from a culture line, the interview process or a remote-or-hybrid choice).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessRemote, bindingAttendanceText } from '../lib/scan-decision.mjs';
import { jevDescriptionExcerpt } from '../lib/jev.mjs';

const FILTER = {
  mode: 'strict_full_remote_only',
  required_any: ['remote'],
  rejected_any: ['hybrid', 'on-site', 'onsite', 'in office', 'relocation'],
};

const offer = (fields) => ({ title: 'Product Designer', url: 'https://jobs.ashbyhq.com/x/1', ...fields });

test('an ATS "Remote" field outranks a stray word in the body', () => {
  const result = assessRemote(offer({
    location: 'Paris',
    remoteEvidence: 'Paris | Remote',
    workMode: 'remote',
    description: 'We have a hybrid office in Paris for those who want it. This position is remote-friendly.',
  }), FILTER);
  assert.notEqual(result.disposition, 'reject', result.reason);
});

test('interview and culture lines bind nothing', () => {
  for (const description of [
    'Interviews will be conducted via virtual meetings and/or onsite.',
    'Build an international environment with a strong remote-friendly culture.',
    'Relocation assistance is available.',
  ]) {
    const result = assessRemote(offer({ location: 'Remote - Europe', remoteEvidence: 'Remote - Europe', description }), FILTER);
    assert.notEqual(result.disposition, 'reject', `${description} → ${result.reason}`);
  }
});

test('"Europe remote or London hybrid" lifts an ATS "Hybrid"', () => {
  const result = assessRemote(offer({
    location: 'London',
    remoteEvidence: 'London | Hybrid | Remote',
    workMode: 'hybrid',
    description: 'Location: Europe remote or London hybrid. A flexible, remote friendly role based out of Europe or one of our hubs.',
  }), FILTER);
  assert.notEqual(result.disposition, 'reject', result.reason);
});

test('a binding hybrid line still rejects, and so does an ATS "OnSite"', () => {
  const hybrid = assessRemote(offer({
    location: 'Espoo',
    remoteEvidence: 'Espoo | Hybrid',
    workMode: 'hybrid',
    description: 'Workplace model: Hybrid (3 days / week in office).',
  }), FILTER);
  assert.equal(hybrid.disposition, 'reject');
  const onsite = assessRemote(offer({
    location: 'San Francisco',
    remoteEvidence: 'San Francisco | OnSite',
    workMode: 'onsite',
    description: 'This position will be onsite in San Francisco, or remote for exceptional candidates.',
  }), FILTER);
  assert.equal(onsite.disposition, 'reject');
});

test('benefit and skill lines bind nothing; a slash choice counts', () => {
  for (const description of [
    'Our chaotic-but-fun, remote-friendly, start-up environment welcomes you.',
    'Enjoy an on-site gym or sports club stipend.',
    'A hybrid UR/UX skill set is a strength.',
    'London (Hybrid) / UK Remote | £90,000 - £120,000.',
    'Flexibility, with remote and hybrid work options (country-dependent).',
  ]) {
    const result = assessRemote(offer({ location: 'Remote - EMEA', remoteEvidence: 'Remote - EMEA', description }), FILTER);
    assert.notEqual(result.disposition, 'reject', `${description} → ${result.reason}`);
  }
});

test('bindingAttendanceText keeps the binding sentences', () => {
  const text = bindingAttendanceText('Interviews may be onsite. The role is hybrid, 2 days in Paris.');
  assert.match(text, /role is hybrid/);
  assert.doesNotMatch(text, /Interviews/);
});

test('the Jev excerpt keeps the location line at the end of a long JD', () => {
  const blurb = 'We build delightful products for millions of people around the world. '.repeat(60);
  const description = `${blurb} Benefits include a gym budget. LOCATION On-site in New York, New York, United States.`;
  const excerpt = jevDescriptionExcerpt(description);
  assert.ok(excerpt.length <= 2000);
  assert.match(excerpt, /On-site in New York/);
  assert.equal(jevDescriptionExcerpt('Short JD, fully remote.'), 'Short JD, fully remote.');
});
