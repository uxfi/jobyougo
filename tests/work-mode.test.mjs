// The pipeline profile gate reads the ATS's own work-mode field before the JD
// text (lib/work-mode.mjs). On 2026-10-16 the text-only detector hard-rejected
// n8n "Internal AI Enablement Lead", `workplaceType: Remote` on Ashby with a
// "Berlin Office" location, because its description said "some roles, like
// sales in the US, are hybrid".
import test from 'node:test';
import assert from 'node:assert/strict';
import { inferWorkModeFromText, resolveWorkMode, structuredWorkMode } from '../lib/work-mode.mjs';

// Shaped like the n8n entry of api.ashbyhq.com/posting-api/job-board/n8n.
const N8N_ASHBY = {
  title: 'Internal AI Enablement Lead',
  location: 'Berlin Office',
  secondaryLocations: [{ location: 'Germany' }, { location: 'Portugal' }, { location: 'United Kingdom' }],
  workplaceType: 'Remote',
  isRemote: true,
};
const N8N_TEXT = [
  'Location / remote: Berlin Office · Germany · Portugal · United Kingdom · Remote',
  'We are a remote company with an office in Berlin. Some roles, like sales in the US, are hybrid, with 2 days a week in the office.',
].join('\n');

test('n8n: Ashby workplaceType Remote with a Berlin Office location is remote', () => {
  const structured = structuredWorkMode('ashby', N8N_ASHBY);
  assert.equal(structured.mode, 'remote');
  assert.deepEqual(structured.locations, ['Berlin Office', 'Germany', 'Portugal', 'United Kingdom']);
  assert.equal(structured.evidence[0], 'ashby workplaceType: Remote');
  const resolved = resolveWorkMode(N8N_TEXT, structured);
  assert.equal(resolved.mode, 'remote');
  assert.equal(resolved.structured, true);
  assert.equal(resolved.source, 'ashby');
});

test('Ashby: Hybrid and OnSite map to the gate modes; isRemote alone counts only when true', () => {
  assert.equal(structuredWorkMode('ashby', { workplaceType: 'Hybrid', location: 'London' }).mode, 'hybrid');
  assert.equal(structuredWorkMode('ashby', { workplaceType: 'OnSite', location: 'Paris' }).mode, 'onsite');
  assert.equal(structuredWorkMode('ashby', { isRemote: true, location: 'Remote' }).mode, 'remote');
  assert.equal(structuredWorkMode('ashby', { isRemote: false, location: 'Berlin' }).mode, 'unknown', 'isRemote false is set on hybrid postings too');
});

test('a structured field wins over contradicting text, both ways', () => {
  assert.equal(resolveWorkMode('Hybrid role, 3 days a week in our Paris office.', structuredWorkMode('ashby', { workplaceType: 'Remote' })).mode, 'remote');
  assert.equal(resolveWorkMode('Fully remote team.', structuredWorkMode('lever', { workplaceType: 'onsite', categories: { location: 'Mexico City' } })).mode, 'onsite');
});

test('Lever: workplaceType and categories.allLocations', () => {
  const hybrid = structuredWorkMode('lever', { workplaceType: 'hybrid', categories: { location: 'Mexico City', allLocations: ['Mexico City', 'Bogotá'] } });
  assert.equal(hybrid.mode, 'hybrid');
  assert.deepEqual(hybrid.locations, ['Mexico City', 'Bogotá']);
  assert.equal(structuredWorkMode('lever', { workplaceType: 'remote', categories: { location: 'Remote - EMEA' } }).mode, 'remote');
  assert.equal(structuredWorkMode('lever', { workplaceType: 'unspecified', categories: { location: 'London' } }).mode, 'unknown');
});

test('Workable: workplace, then the remote flag', () => {
  // Shaped like apply.workable.com/api/v2/accounts/cloudtalk/jobs/2B7FA6A0F6.
  const remote = structuredWorkMode('workable', {
    remote: true,
    workplace: 'remote',
    location: { city: '', country: 'Czechia', region: null },
    locations: [{ city: '', country: 'Czechia' }, { city: '', country: 'Spain' }],
  });
  assert.equal(remote.mode, 'remote');
  assert.deepEqual(remote.locations, ['Czechia', 'Spain']);
  assert.equal(structuredWorkMode('workable', { remote: false, workplace: 'hybrid', location: { city: 'Toronto', country: 'Canada', region: 'Ontario' } }).mode, 'hybrid');
  assert.equal(structuredWorkMode('workable', { remote: false, workplace: 'on_site', location: { city: 'Toronto' } }).mode, 'onsite');
  assert.equal(structuredWorkMode('workable', { remote: true, location: { country: 'Spain' } }).mode, 'remote');
});

test('Greenhouse: the location name, a city alone left to the text', () => {
  assert.equal(structuredWorkMode('greenhouse', { location: { name: 'EMEA - Remote, UNITED STATES - Remote' } }).mode, 'remote');
  assert.equal(structuredWorkMode('greenhouse', { location: { name: 'Hybrid - London' } }).mode, 'hybrid');
  assert.equal(structuredWorkMode('greenhouse', { location: { name: 'Berlin' }, offices: [{ name: 'Berlin' }] }).mode, 'unknown');
  const both = structuredWorkMode('greenhouse', { location: { name: 'London (Hybrid) or Remote UK' } });
  assert.equal(both.mode, 'unknown');
  assert.equal(both.ambiguous, true);
  // An ambiguous field never falls back to the text's hard verdict.
  const resolved = resolveWorkMode('Hybrid, 3 days a week in our London office.', both);
  assert.equal(resolved.mode, 'unknown');
  assert.equal(resolved.ambiguous, true);
});

test('no structured field: the text decides, as before', () => {
  assert.equal(resolveWorkMode('Hybrid, 3 days a week in the office.', null).mode, 'hybrid');
  assert.equal(resolveWorkMode('Location: London, England\n\nStaff Product Designer.', structuredWorkMode('greenhouse', { location: { name: 'London, England' } })).implied, true);
  assert.equal(resolveWorkMode('Remote within Europe.', structuredWorkMode('lever', {})).mode, 'remote');
  assert.equal(resolveWorkMode('Product Designer.', null).mode, 'unknown');
  assert.equal(resolveWorkMode('', structuredWorkMode('nope', { workplaceType: 'Remote' })).mode, 'unknown');
});

test('text with both a remote claim and office wording is unknown, not a hard verdict', () => {
  for (const jd of [
    'This is a fully remote role. We meet for quarterly on-site offsites.',
    'Remote-first company. Hybrid options in our Paris hub for those nearby.',
    'This role is remote. Some teams work 3 days a week from our London office.',
  ]) {
    const mode = inferWorkModeFromText(jd);
    assert.equal(mode.mode, 'unknown', jd);
    assert.equal(mode.ambiguous, true, jd);
    assert.ok(mode.evidence.length >= 2, 'evidence from both sides');
  }
  // A negated remote claim is office wording only.
  assert.equal(inferWorkModeFromText('This is not a fully remote role: hybrid, 3 days a week.').mode, 'hybrid');
  // Bare "remote" next to hybrid wording stays hybrid.
  assert.equal(inferWorkModeFromText('Hybrid: 3 days in the office, 2 days remote.').mode, 'hybrid');
  // A remote perk of an office job stays on-site.
  assert.equal(inferWorkModeFromText('Based in our Ho Chi Minh City office. 6 week remote working (work from anywhere) policy.').mode, 'onsite');
});
