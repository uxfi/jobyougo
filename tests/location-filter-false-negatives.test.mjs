import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLocationFilter, titleSignalsRemote } from '../scan.mjs';
import { evaluateCandidate } from '../lib/scan-decision.mjs';
import { resolveLocationProfile } from '../lib/candidate-location.mjs';

// 2026-10-20 audit of 713 location rejects: the allow list names countries, so
// city-only strings lost real matches. Two false-negative classes, fixed here.
const LOCATION_FILTER = {
  allow: ['remote', 'worldwide', 'anywhere', 'europe', 'thailand', 'germany', 'philippines', 'singapore'],
  block: ['united states', 'usa', 'us'],
};
const PROFILE = resolveLocationProfile({
  location: {
    country: 'France', city: 'Paris', asia_city: 'Bangkok', asia_country: 'Thailand',
    remote_policy: 'Full remote required',
    onsite_availability: 'Open to on-site or hybrid in Bangkok only; comfortable traveling for offsites anywhere',
  },
});
const filter = buildLocationFilter(LOCATION_FILTER);
const decide = (c) => evaluateCandidate(
  { url: 'https://example.com/j/' + encodeURIComponent(c.title), company: 'Acme', ...c },
  { location_filter: LOCATION_FILTER },
  { locationProfile: PROFILE, locationAllows: (cand, ctx) => filter(cand.location, cand.url, cand.title, ctx) },
);

test('fixture profile opens Bangkok on site', () => {
  assert.deepEqual(PROFILE.onsiteExceptions.map((e) => e.city), ['Bangkok']);
});

test('work-from-home title markers rescue a city-only location', () => {
  for (const t of [
    'Senior UX/UI Designer (Home Office) (m/w/d)',
    'Senior Product Designer | Work From Home | Day Shift',
    'UI/UX Developer (with Frontend Exp) - WFH',
    'Product Designer - Full Remote',
    'Senior Designer [100% Homeoffice]',
  ]) assert.equal(titleSignalsRemote(t), true, t);
  assert.equal(filter('Berlin', '', 'Senior UX/UI Designer (Home Office) (m/w/d)'), true);
  assert.equal(filter('Metro Manila', '', 'Senior Product Designer | Work From Home | Day Shift'), true);
});

test('no false rescue: UK Home Office, negations, blocked geographies, plain city titles', () => {
  for (const t of ['Senior Designer, Home Office', 'Product Designer (not remote)', 'Product Designer - Hybrid', 'Home Office Furniture Designer'])
    assert.equal(titleSignalsRemote(t), false, t);
  assert.equal(filter('London', '', 'Senior Designer, Home Office'), false);
  assert.equal(filter('Austin, TX, USA', '', 'Product Designer - WFH'), false, 'block still wins');
  assert.equal(filter('Berlin', '', 'Senior Product Designer'), false);
});

test('a Bangkok-located posting is not dropped by the country-level allow list', () => {
  for (const location of ['Bangkok', 'Khlong Toei, Bangkok', 'Pathum Wan, Bangkok']) {
    const d = decide({ title: 'Senior Product Designer', location });
    assert.notEqual(d.reasonCode, 'location', location);
  }
});

test('on-site outside Bangkok stays rejected', () => {
  for (const location of ['Pathum Thani', 'Berlin', 'Kuala Lumpur', 'D01 Marina, Raffles Place']) {
    const d = decide({ title: 'Senior Product Designer', location });
    assert.equal(d.reasonCode, 'location', location);
  }
  const hybridParis = decide({ title: 'Senior Product Designer - Hybrid', location: 'Paris' });
  assert.equal(hybridParis.disposition, 'reject');
});