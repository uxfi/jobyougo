// lib/candidate-location.mjs: one reading of where a candidate works, for any
// profile (generic `bases` or the older city/asia_city fields).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authorizedFor,
  locationSummaryLines,
  onsitePlacesFromText,
  resolveLocationProfile,
  selectBase,
  timezoneOption,
  workModeAllowed,
} from '../lib/candidate-location.mjs';
import { countryOfNationality, dialCodeOf, regionTagsIn, regionTagsOf } from '../lib/apply-places.mjs';
import { formDialCode } from '../lib/apply-fill-guards.mjs';

// The owner's profile.yml shape before `bases` existed.
const LEGACY_DUAL_BASE = {
  candidate: { phone: '+33 6 00 00 00 00', phone_asia: '+66 60 000 0000' },
  location: {
    country: 'France', city: 'Paris', default_city: 'Paris', default_country: 'France',
    asia_city: 'Bangkok', asia_country: 'Thailand',
    timezone: 'CET/CEST or ICT (UTC+7), depending on the offer',
    visa_status: 'No sponsorship needed -- French / EU citizen',
    authorized_in: ['France', 'European Union', 'European Economic Area', 'Thailand'],
    needs_sponsorship: true,
    remote_policy: 'Full remote required',
  },
  search: { onsite_availability: 'Open to on-site if based in Thailand; comfortable traveling for multi-day team-building/offsite events anywhere' },
};

test('legacy fields give two bases with phones, zones, regions and statuses', () => {
  const loc = resolveLocationProfile(LEGACY_DUAL_BASE);
  assert.deepEqual(loc.bases.map(b => b.id), ['paris', 'bangkok']);
  const [paris, bangkok] = loc.bases;
  assert.equal(paris.default, true);
  assert.equal(paris.timezone, 'Europe/Paris');
  assert.equal(paris.phone, '+33 6 00 00 00 00');
  assert.equal(paris.dialCode, '+33');
  assert.ok(paris.regions.includes('EU') && paris.regions.includes('GLOBAL'));
  assert.equal(paris.status, 'citizen');
  assert.equal(bangkok.timezone, 'Asia/Bangkok');
  assert.equal(bangkok.utcOffset, 7);
  assert.equal(bangkok.phone, '+66 60 000 0000');
  assert.deepEqual(bangkok.regions, ['APAC']);
  assert.equal(bangkok.status, 'authorized');
  assert.equal(loc.nationality, 'French');
  assert.equal(loc.fullRemoteOnly, true);
  assert.equal(loc.relocation, false);
  assert.equal(loc.travel.offsites, true);
  assert.deepEqual(loc.onsitePlaces, ['Thailand', 'Bangkok']);
});

test('generic bases and structured on-site exceptions win over legacy fields', () => {
  const loc = resolveLocationProfile({
    candidate: { phone: '+351 900 000 000' },
    location: {
      bases: [
        { city: 'Lisbon', country: 'Portugal', default: true },
        { city: 'Austin', country: 'United States', timezone: 'America/Chicago', phone: '+1 512 000 0000', status: 'citizen' },
      ],
      city: 'Lisbon', country: 'Portugal',
      authorized_in: ['European Union', 'United States'],
      remote_policy: 'full_remote',
      onsite_exceptions: [{ city: 'Austin', country: 'United States', modes: ['hybrid'] }],
      nationality: 'Portuguese, American',
    },
  });
  assert.deepEqual(loc.bases.map(b => b.label), ['Lisbon, Portugal', 'Austin, United States']);
  assert.equal(loc.bases[0].phone, '+351 900 000 000', 'the first base falls back to candidate.phone');
  assert.equal(loc.bases[1].timezone, 'America/Chicago');
  assert.deepEqual(loc.bases[1].regions, ['AMERICAS']);
  assert.equal(workModeAllowed(loc, { mode: 'hybrid', text: 'Hybrid, 2 days a week in Austin, TX' }).ok, true);
  assert.equal(workModeAllowed(loc, { mode: 'onsite', text: 'On-site in Austin, TX' }).ok, false, 'the exception only opens hybrid');
  assert.equal(workModeAllowed(loc, { mode: 'hybrid', text: 'Hybrid in Lisbon' }).ok, false);
  assert.equal(authorizedFor(loc, 'United States'), true);
  assert.equal(authorizedFor(loc, 'Germany'), true);
  assert.equal(authorizedFor(loc, 'Canada'), false);
});

test('a city changed on the dashboard replaces the stale default base', () => {
  const loc = resolveLocationProfile({
    candidate: { phone: '+34 600 000 000' },
    location: {
      city: 'Lisbon', country: 'Portugal',
      bases: [{ city: 'Madrid', country: 'Spain', timezone: 'Europe/Madrid', regions: ['EU'], default: true, status: 'citizen' }],
    },
  });
  assert.deepEqual(loc.bases.map(b => b.label), ['Lisbon, Portugal']);
  assert.equal(loc.bases[0].timezone, 'Europe/Lisbon', 'the old zone does not follow the move');
  assert.equal(loc.bases[0].phone, '+34 600 000 000');
  // Its own country is a place to work from: no sponsorship there.
  assert.equal(authorizedFor(loc, 'Portugal'), true);
});

test('a profile without remote policy never refuses an attendance mode', () => {
  const loc = resolveLocationProfile({ location: { city: 'Berlin', country: 'Germany' } });
  assert.equal(loc.fullRemoteOnly, false);
  assert.equal(workModeAllowed(loc, { mode: 'onsite', text: 'On-site in Munich' }).ok, true);
  assert.deepEqual(loc.bases.map(b => b.timezone), ['Europe/Berlin']);
});

test('an empty profile has no base and an open policy', () => {
  const loc = resolveLocationProfile({});
  assert.deepEqual(loc.bases, []);
  assert.equal(loc.defaultBase, null);
  assert.equal(selectBase(loc, { text: 'Remote APAC' }).base, null);
  assert.equal(authorizedFor(loc, 'France'), null);
});

test('selectBase picks the base an offer locates, else the default', () => {
  const loc = resolveLocationProfile(LEGACY_DUAL_BASE);
  const pick = text => selectBase(loc, { text }).base.id;
  assert.equal(pick('Remote - APAC (Singapore, Bangkok)'), 'bangkok');
  assert.equal(pick('Remote, Southeast Asia'), 'bangkok');
  assert.equal(pick('Remote (UTC+7 overlap required)'), 'bangkok');
  assert.equal(pick('EMEA - Remote, UNITED STATES - Remote'), 'paris');
  assert.equal(pick('Europe (Remote)'), 'paris');
  assert.equal(pick('Worldwide remote'), 'paris');
  assert.equal(pick(''), 'paris');
  assert.equal(selectBase(loc, { text: 'Remote, EMEA', legacyRegion: 'asia' }).base.id, 'bangkok', 'the old region override still wins');
});

test('on-site availability text opens named places and the base they belong to', () => {
  const bases = resolveLocationProfile(LEGACY_DUAL_BASE).bases;
  assert.deepEqual(onsitePlacesFromText('On-site OK in Lisbon or Porto, hybrid at Berlin', bases), ['Lisbon', 'Porto', 'Berlin']);
  assert.deepEqual(onsitePlacesFromText('on-site ok if based in thailand', bases), ['Bangkok', 'Thailand']);
  assert.deepEqual(onsitePlacesFromText('Open to on-site or hybrid in Bangkok only; traveling for offsites anywhere', bases), ['Bangkok']);
  assert.deepEqual(onsitePlacesFromText('No on-site in France; traveling to Paris for offsites is fine', bases), []);
});

test('prompt lines list every base and how it is chosen', () => {
  const lines = locationSummaryLines(resolveLocationProfile(LEGACY_DUAL_BASE));
  assert.match(lines[0], /^- Paris, France — Europe\/Paris \(UTC\+[12]\) — default base — citizen$/);
  assert.match(lines[1], /^- Bangkok, Thailand — Asia\/Bangkok \(UTC\+7\) — for APAC offers — authorized$/);
  assert.match(lines[2], /chosen per offer/);
});

test('place helpers: region tags, dial codes, nationality', () => {
  assert.deepEqual(regionTagsOf('Thailand'), ['APAC']);
  assert.deepEqual(regionTagsOf('United Kingdom'), ['EUROPE', 'EMEA']);
  assert.deepEqual(regionTagsIn('EMEA - Remote, UNITED STATES - Remote'), ['EMEA']);
  assert.equal(dialCodeOf('Germany'), '+49');
  assert.equal(formDialCode('', 'Japan'), '+81');
  assert.equal(formDialCode('+44 20 0000 0000', 'France'), '+44');
  assert.equal(countryOfNationality('No sponsorship needed -- French / EU citizen'), 'France');
});

// 2026-10-13 review: a legacy row with only a location text, EU nationals in
// another EU country, time-zone rows for any IANA zone.
test('a legacy row with only a location text still has its base', () => {
  const loc = resolveLocationProfile({ candidate: { location: 'Berlin, Germany' } });
  assert.deepEqual(loc.bases.map((b) => [b.city, b.country]), [['Berlin', 'Germany']]);
  assert.equal(authorizedFor(loc, 'Germany'), true);
  assert.deepEqual(resolveLocationProfile({ candidate: { location: 'Somewhere nice' } }).bases, []);
});

test('an EU national based in another EU country is an EU citizen there, not a visa holder', () => {
  const loc = resolveLocationProfile({
    location: {
      nationality: 'French',
      authorized_in: ['European Union', 'Thailand'],
      bases: [{ city: 'Lisbon', country: 'Portugal', default: true }, { city: 'Paris', country: 'France' }, { city: 'Bangkok', country: 'Thailand' }],
    },
  });
  assert.deepEqual(loc.bases.map((b) => b.status), ['eu_citizen', 'citizen', 'authorized']);
});

test('time-zone rows: names, offsets and regions for any IANA zone', () => {
  assert.equal(timezoneOption(['UTC+05:30', 'UTC+08:00'], { zone: 'Asia/Kolkata', country: 'India' }), 'UTC+05:30');
  assert.equal(timezoneOption(['AEST (UTC+10)', 'NZST (UTC+12)'], { zone: 'Australia/Sydney', country: 'Australia' }), 'AEST (UTC+10)');
  assert.equal(timezoneOption(['+1', '+7'], { country: 'Thailand' }), '+7', 'the country zone stands in');
  assert.equal(timezoneOption(['North America', 'Europe', 'Asia'], { zone: 'Europe/Lisbon', country: 'Portugal' }), 'Europe');
  assert.equal(timezoneOption(['Americas', 'APAC'], { zone: 'Europe/Paris', country: 'France' }), null);
  assert.equal(timezoneOption([], { zone: 'Europe/Paris' }), null);
});
