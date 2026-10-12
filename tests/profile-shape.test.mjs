import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARCHETYPE_LEVELS,
  coerceParsedProfile,
  computeProfileStatus,
  extractJsonObject,
  homeLocationLabel,
  isMissingColumnError,
  isSupabaseProfileRow,
  languageLabel,
  mergeProfileSections,
  normalizeGithub,
  normalizeLinkedin,
  normalizeProfileRow,
  profileToRow,
  sanitizeProfileInput,
  yearsFromValue,
} from '../lib/profile-shape.mjs';
import { buildCvTemplateDataFromProfile, parseCvMarkdownForTemplate } from '../lib/cv-template-data.mjs';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as yamlLoad } from 'js-yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function hasOwnKey(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

const ROW = {
  id: 'u1',
  full_name: 'Jane Doe',
  email: 'jane@example.com',
  location: 'Lyon, France',
  linkedin: 'linkedin.com/in/janedoe',
  target_roles: { primary: ['Senior Backend Engineer'], archetypes: [] },
  narrative: { headline: 'Backend lead', exit_story: '', superpowers: ['Go'], proof_points: [] },
  compensation: { target_range: '70K-90K', currency: 'EUR', minimum: '' },
  search_prefs: { must_haves: ['remote'], deal_breakers: [] },
  location_prefs: { country: 'France', city: 'Lyon', remote_policy: 'Full remote only (required)', authorized_in: ['France', 'European Union'], needs_sponsorship: false },
  cv_markdown: '# Jane',
  profile_context: '',
  is_admin: false,
  candidate: { phone: '+33 6 00 00 00 00', github: 'github.com/jane', years_experience: 9, languages: ['French (native)'] },
  availability: { notice_period: '1 month' },
  preferences: { language: { output: 'fr' }, spend_tier: 'premium' },
  onboarding_completed_at: '2026-10-07T10:00:00Z',
};

const YAML_PROFILE = {
  candidate: { full_name: 'Hugo', email: 'h@example.com', location: 'Paris' },
  target_roles: { primary: ['Product Designer'] },
  location: { country: 'France', city: 'Paris' },
  search: { must_haves: ['AI'] },
  language: { output: 'en' },
};

test('isSupabaseProfileRow tells the flat row from the nested YAML shape', () => {
  assert.equal(isSupabaseProfileRow(ROW), true);
  assert.equal(isSupabaseProfileRow({ full_name: 'x', email: 'y', location: 'Paris' }), true);
  assert.equal(isSupabaseProfileRow(YAML_PROFILE), false);
  assert.equal(isSupabaseProfileRow({}), false);
  assert.equal(isSupabaseProfileRow(null), false);
});

test('normalizeProfileRow turns the flat row into the nested shape the evaluators read', () => {
  const p = normalizeProfileRow(ROW);
  assert.equal(p.candidate.full_name, 'Jane Doe');
  assert.equal(p.candidate.location, 'Lyon, France');
  assert.equal(p.candidate.phone, '+33 6 00 00 00 00');
  assert.equal(p.candidate.years_experience, 9);
  assert.deepEqual(p.candidate.languages, ['French (native)']);
  assert.equal(p.location.country, 'France');
  assert.equal(p.location.remote_policy, 'Full remote only (required)');
  assert.deepEqual(p.location.authorized_in, ['France', 'European Union']);
  assert.deepEqual(p.search.must_haves, ['remote']);
  assert.equal(p.availability.notice_period, '1 month');
  assert.equal(p.language.output, 'fr');
  assert.equal(p.spend_tier, 'premium');
  assert.equal(p.account.is_admin, false);
  assert.equal(p.account.onboarding_completed_at, '2026-10-07T10:00:00Z');
  // No flat keys leak to the top level: the dashboard's detector relies on it.
  assert.equal(p.full_name, undefined);
  assert.equal(p.is_admin, undefined);
  assert.equal(p.location_prefs, undefined);
});

test('normalizeProfileRow keeps a nested profile as-is and guarantees section objects', () => {
  const p = normalizeProfileRow(YAML_PROFILE);
  assert.equal(p.candidate.full_name, 'Hugo');
  assert.deepEqual(p.narrative, {});
  assert.deepEqual(p.compensation, {});
  assert.equal(p.language.output, 'en');
});

test('normalizeProfileRow handles a row before the migration (no candidate column)', () => {
  const legacy = { ...ROW };
  delete legacy.candidate; delete legacy.availability; delete legacy.preferences; delete legacy.onboarding_completed_at;
  const p = normalizeProfileRow(legacy);
  assert.equal(p.candidate.full_name, 'Jane Doe');
  assert.equal(p.candidate.phone, undefined);
  assert.deepEqual(p.availability, {});
  assert.equal(p.language, undefined);
});

test('mergeProfileSections keeps what the client did not send', () => {
  const stored = normalizeProfileRow(ROW);
  const fromDashboard = {
    candidate: { full_name: 'Jane Doe', email: 'jane@example.com', phone: '', location: 'Lyon, France', linkedin: 'linkedin.com/in/janedoe', portfolio_url: 'https://jane.dev', github: 'github.com/jane', twitter: '' },
    target_roles: { primary: ['Staff Engineer'], archetypes: [] },
    search: { must_haves: [] },
  };
  const merged = mergeProfileSections(stored, fromDashboard);
  assert.equal(merged.candidate.years_experience, 9, 'years survive a client that does not know the field');
  assert.deepEqual(merged.candidate.languages, ['French (native)']);
  assert.equal(merged.candidate.phone, '', 'an explicit empty string clears the field');
  assert.equal(merged.candidate.portfolio_url, 'https://jane.dev');
  assert.deepEqual(merged.target_roles.primary, ['Staff Engineer'], 'arrays are replaced wholesale');
  assert.deepEqual(merged.search.must_haves, []);
  assert.equal(merged.location.country, 'France', 'untouched sections stay');
  assert.equal(merged.availability.notice_period, '1 month');
  assert.equal(merged.spend_tier, 'premium');
  assert.equal(merged.account, undefined);
});

test('mergeProfileSections accepts null to clear a section and legacy flat aliases', () => {
  const merged = mergeProfileSections(normalizeProfileRow(ROW), { search: null, location_prefs: { city: 'Nantes' } });
  assert.deepEqual(merged.search, {});
  assert.equal(merged.location.city, 'Nantes');
  assert.equal(merged.location.country, 'France');
});

test('profileToRow mirrors identity in the legacy columns and keeps the rest in jsonb', () => {
  const { legacy, extended } = profileToRow(normalizeProfileRow(ROW), 'u1');
  assert.equal(legacy.id, 'u1');
  assert.equal(legacy.full_name, 'Jane Doe');
  assert.equal(legacy.email, 'jane@example.com');
  assert.equal(legacy.location, 'Lyon, France');
  assert.equal(legacy.linkedin, 'linkedin.com/in/janedoe');
  assert.equal(legacy.location_prefs.country, 'France');
  assert.deepEqual(legacy.search_prefs.must_haves, ['remote']);
  assert.equal(legacy.candidate, undefined);
  assert.equal(extended.candidate.phone, '+33 6 00 00 00 00');
  assert.equal(extended.availability.notice_period, '1 month');
  assert.equal(extended.preferences.spend_tier, 'premium');
  assert.equal(extended.preferences.language.output, 'fr');
});

test('isMissingColumnError recognizes PostgREST unknown-column answers', () => {
  assert.equal(isMissingColumnError({ code: 'PGRST204', message: "Could not find the 'candidate' column of 'profiles' in the schema cache" }), true);
  assert.equal(isMissingColumnError({ message: 'column "availability" of relation "profiles" does not exist' }), true);
  assert.equal(isMissingColumnError({ code: '23505', message: 'duplicate key' }), false);
  assert.equal(isMissingColumnError(null), false);
});

test('computeProfileStatus lists what the pipeline cannot run without', () => {
  const empty = computeProfileStatus({}, '');
  assert.equal(empty.complete, false);
  assert.deepEqual(empty.missing, ['identity', 'target_roles', 'location', 'cv']);
  assert.equal(empty.completion, 0);

  const full = computeProfileStatus(ROW, '# Jane\n\n## Experience\n### Acme\n**Lead**\n- shipped');
  assert.equal(full.complete, true);
  assert.deepEqual(full.missing, []);
  assert.ok(full.completion > 60, `completion ${full.completion}`);
  assert.equal(full.checks.work_authorization, true);
  assert.equal(full.checks.availability, true);
  assert.equal(full.onboarding_completed_at, '2026-10-07T10:00:00Z');

  const noCv = computeProfileStatus(ROW, '   ');
  assert.deepEqual(noCv.missing, ['cv']);
  assert.ok(noCv.recommended.includes('proof_points'));
});

test('computeProfileStatus accepts the nested YAML profile too', () => {
  const s = computeProfileStatus(YAML_PROFILE, 'cv');
  assert.equal(s.complete, true);
});

test('homeLocationLabel derives the home base from the profile, never a constant', () => {
  assert.equal(homeLocationLabel(ROW), 'Lyon, France');
  assert.equal(homeLocationLabel({ candidate: { location: 'Berlin' } }), 'Berlin');
  assert.equal(homeLocationLabel({ location: { country: 'Spain' } }), 'Spain');
  assert.equal(homeLocationLabel({}), "the candidate's home location");
});

test('coerceParsedProfile makes the LLM output safe for the form', () => {
  const parsed = coerceParsedProfile({
    candidate: { full_name: '  Jane ', email: 'j@x.io', years_experience: '12 years', languages: ['French (native)', { name: 'English', level: 'C1' }, ''], unknown: 'x' },
    target_roles: { primary: ['A', '', 'B', 'C', 'D', 'E', 'F'], archetypes: [{ name: 'Designer', level: 'senior', fit: 'PRIMARY' }, { level: 'Mid' }, 'junk'] },
    narrative: { superpowers: 'not-a-list', proof_points: [{ name: 'Proj', hero_metric: 42 }, { url: 'x' }] },
    compensation: { currency: 'eur' },
    location: { country: 'France' },
    search: { must_haves: ['remote', 7] },
  });
  assert.equal(parsed.candidate.full_name, 'Jane');
  assert.equal(parsed.candidate.years_experience, 12);
  assert.deepEqual(parsed.candidate.languages, ['French (native)', 'English (C1)']);
  assert.equal(parsed.candidate.unknown, undefined);
  assert.deepEqual(parsed.target_roles.primary, ['A', 'B', 'C'], 'the onboarding asks for 1-3 titles');
  assert.deepEqual(parsed.target_roles.archetypes, [{ name: 'Designer', level: 'Senior', fit: 'primary' }]);
  assert.deepEqual(parsed.narrative.superpowers, []);
  assert.deepEqual(parsed.narrative.proof_points, [{ name: 'Proj', url: '', hero_metric: '42' }]);
  assert.equal(parsed.compensation.currency, 'EUR');
  assert.deepEqual(parsed.search.must_haves, ['remote']);
  assert.deepEqual(parsed.search.deal_breakers, []);
  // Keys of the cv-parse contract are always present.
  assert.deepEqual(parsed.search.current_role, { title: '', company: '', start_month: '', start_year: '', current: false });
  assert.deepEqual(parsed.availability, { notice_period: '', start_date: '', current_employment: '' });
  assert.deepEqual(parsed.language, { output: '' });
  assert.equal(parsed.location.postal_code, '');
  assert.deepEqual(parsed.location.authorized_in, []);
  assert.equal(parsed.compensation.employment_type, '');
  assert.equal(parsed.location.needs_sponsorship, undefined, 'never inferred from a CV');
});

test('coerceParsedProfile: years, currency, handles, levels and the new keys', () => {
  const years = v => coerceParsedProfile({ candidate: { years_experience: v } }).candidate.years_experience;
  assert.equal(years('12+ years'), 12);
  assert.equal(years('8,5 ans'), 9);
  assert.equal(years('2015-2020'), '', 'digits are never glued together: 20152020 used to be clipped to garbage');
  assert.equal(years('about 10 (since 2016)'), 10);
  assert.equal(years(7), 7);
  assert.equal(years('none'), '');
  const currency = v => coerceParsedProfile({ compensation: { currency: v } }).compensation.currency;
  assert.equal(currency('EUR/USD'), 'EUR', 'not "EUR/U"');
  assert.equal(currency('usd'), 'USD');
  assert.equal(currency('€'), 'EUR');
  assert.equal(currency(''), '');

  const parsed = coerceParsedProfile({
    candidate: { linkedin: 'https://fr.linkedin.com/in/jane-doe/?trk=x', github: 'https://github.com/jane/ledger' },
    target_roles: { archetypes: [
      { name: 'A', level: 'LEAD' }, { name: 'B', level: 'director' }, { name: 'C', level: 'mid-level' }, { name: 'D', level: 'guru' }, { name: 'E', level: 'Staff' },
    ] },
    location: { postal_code: '69001', authorized_in: ['France', 'European Union', 3] },
    compensation: { employment_type: 'Full-time' },
    search: { current_role: { title: 'Lead', company: 'Acme', start_month: '3', start_year: 'since 2021', current: true } },
    availability: { notice_period: '1 month', current_employment: 'Freelancing' },
    language: { output: 'FR' },
  });
  assert.equal(parsed.candidate.linkedin, 'linkedin.com/in/jane-doe');
  assert.equal(parsed.candidate.github, 'github.com/jane');
  assert.deepEqual(parsed.target_roles.archetypes.map(a => a.level), ['Lead', 'Director', 'Mid', ''], 'four archetypes at most, levels normalized');
  assert.equal(parsed.location.postal_code, '69001');
  assert.deepEqual(parsed.location.authorized_in, ['France', 'European Union']);
  assert.equal(parsed.compensation.employment_type, 'Full-time');
  assert.deepEqual(parsed.search.current_role, { title: 'Lead', company: 'Acme', start_month: '03', start_year: '2021', current: true });
  assert.equal(parsed.availability.current_employment, 'Freelancing');
  assert.equal(coerceParsedProfile({ availability: { current_employment: 'Probably looking' } }).availability.current_employment, '');
  assert.equal(parsed.language.output, 'fr');
  assert.deepEqual(ARCHETYPE_LEVELS, ['Junior', 'Mid', 'Senior', 'Lead', 'Staff', 'Principal', 'Director']);
});

test('normalizeLinkedin / normalizeGithub', () => {
  assert.equal(normalizeLinkedin('linkedin.com/in/jane'), 'linkedin.com/in/jane');
  assert.equal(normalizeLinkedin('https://www.linkedin.com/in/jane-doe-123/'), 'linkedin.com/in/jane-doe-123');
  assert.equal(normalizeLinkedin('in/jane'), 'linkedin.com/in/jane');
  assert.equal(normalizeLinkedin('@jane-doe'), 'linkedin.com/in/jane-doe');
  assert.equal(normalizeLinkedin('https://linkedin.com/company/acme'), '', 'a company page is not the candidate');
  assert.equal(normalizeLinkedin('jane.dev'), '');
  assert.equal(normalizeLinkedin('Jane Doe'), '');
  assert.equal(normalizeGithub('https://github.com/jane'), 'github.com/jane');
  assert.equal(normalizeGithub('github.com/jane/ledger?tab=readme'), 'github.com/jane');
  assert.equal(normalizeGithub('jane'), 'github.com/jane');
  assert.equal(normalizeGithub('https://github.com/orgs/acme'), '');
  assert.equal(normalizeGithub('jane.github.io'), '');
});

test('languageLabel and extractJsonObject helpers', () => {
  assert.equal(languageLabel({ name: 'Spanish', level: 'B2' }), 'Spanish (B2)');
  assert.equal(languageLabel('German'), 'German');
  assert.equal(languageLabel({}), '');
  assert.deepEqual(extractJsonObject('Sure! ```json\n{"a": 1}\n```'), { a: 1 });
  assert.deepEqual(extractJsonObject('{"a": {"b": [1, 2]}} trailing'), { a: { b: [1, 2] } });
  assert.throws(() => extractJsonObject('no json here'));
  // Balanced and string-aware: prose with a brace after the object, a brace
  // inside a value, a second object.
  assert.deepEqual(extractJsonObject('{"a": "x}y"} and then {oops}'), { a: 'x}y' });
  assert.deepEqual(extractJsonObject('{"q": "say \\"}\\" now"} {"b": 2}'), { q: 'say "}" now' });
  assert.deepEqual(extractJsonObject('{not json} {"b": 2}'), { b: 2 }, 'the first object that parses');
  assert.throws(() => extractJsonObject('{"candidate": {"full_name": "Jane"'), /no complete JSON object/, 'a cut-off answer is not repaired');
});

test('sanitizeProfileInput keeps known sections, drops values over their caps, never throws', () => {
  const huge = 'x'.repeat(10_000);
  const out = sanitizeProfileInput({
    candidate: { full_name: 'x'.repeat(1001), years_experience: '12 years', languages: ['French (native)', 42, null, { name: 'English', level: 'C1' }], default_city: 'Lyon' },
    location: { country: 'France', needs_sponsorship: 'no', authorized_in: Array.from({ length: 80 }, (_, i) => `C${i}`) },
    search: { must_haves: ['remote'], current_role: { title: 'Lead', start_year: '2021', current: true } },
    narrative: { exit_story: huge, proof_points: [{ name: 'P', url: 'u', hero_metric: 'm', extra: { a: 1 } }] },
    target_roles: 'not an object',
    availability: null,
    language: { output: 'fr' },
    spend_tier: 'premium',
    cv: { template: 'premium' },
    search_prefs: { deal_breakers: ['onsite'] },
    full_name: 'Flat Jane',
    is_admin: true,
    id: 'someone-else',
    __proto__: { polluted: true },
    constructor: 'x',
  });
  assert.equal(hasOwnKey(out.candidate, 'full_name'), false, 'a name over 1000 characters is left out, never clipped');
  assert.equal(out.narrative.exit_story, huge, 'prose up to 10,000 characters is kept whole');
  assert.equal(out.candidate.years_experience, 12);
  assert.equal(out.candidate.default_city, 'Lyon', 'unknown keys inside a section survive');
  assert.deepEqual(out.candidate.languages, ['French (native)', 42, { name: 'English', level: 'C1' }], 'null items are skipped');
  assert.equal(out.location.needs_sponsorship, false);
  assert.equal(out.location.country, 'France');
  assert.equal(hasOwnKey(out.location, 'authorized_in'), false, 'a list over 50 items is left out, never cut');
  assert.deepEqual(out.search.current_role, { title: 'Lead', start_year: '2021', current: true });
  assert.deepEqual(out.narrative.proof_points, [{ name: 'P', url: 'u', hero_metric: 'm', extra: { a: 1 } }]);
  assert.equal(out.target_roles, undefined, 'a section must be an object');
  assert.equal(out.availability, null, 'null still clears a section');
  assert.deepEqual(out.language, { output: 'fr' });
  assert.equal(out.spend_tier, 'premium');
  assert.deepEqual(out.cv, { template: 'premium' });
  assert.deepEqual(out.search_prefs, { deal_breakers: ['onsite'] });
  assert.equal(out.full_name, 'Flat Jane');
  assert.equal(out.is_admin, undefined);
  assert.equal(out.id, undefined);
  assert.equal(out.constructor, Object, 'no own "constructor" key');
  assert.equal({}.polluted, undefined);
  assert.deepEqual(sanitizeProfileInput('nope'), {});
  assert.deepEqual(sanitizeProfileInput(null), {});
  assert.deepEqual(sanitizeProfileInput([1, 2]), {});
  assert.deepEqual(sanitizeProfileInput({ location: { needs_sponsorship: 'maybe' } }), { location: {} });

  const merged = mergeProfileSections(normalizeProfileRow(ROW), sanitizeProfileInput({ candidate: { phone: '+33 7' } }));
  assert.equal(merged.candidate.phone, '+33 7');
  assert.equal(merged.candidate.years_experience, 9, 'the merge still keeps what the client did not send');
});

// A save replays the whole stored profile (the onboarding sends every key it
// loaded): nothing in it may come back shorter.
function roundTrip(stored, edit = p => p) {
  return mergeProfileSections(stored, sanitizeProfileInput(edit(structuredClone(stored))));
}

test('sanitizeProfileInput: a stored photo and long text survive a save round-trip', () => {
  const photo = `data:image/jpeg;base64,${'A'.repeat(60_000)}`;
  const stored = {
    candidate: { full_name: 'Jane', photo, photo_style: 'circle' },
    target_roles: { primary: ['Designer'] },
    narrative: {
      exit_story: 'e'.repeat(2600),
      proof_points: [{ name: 'Ledger', url: 'https://jane.dev', hero_metric: 'm'.repeat(900) }],
      superpowers: ['s'.repeat(1500)],
    },
    compensation: {}, location: { country: 'France' }, search: {},
    cover_letter: { language_learning: [{ language: 'Spanish', countries: ['Spain', 'Mexico'] }] },
  };
  assert.deepEqual(roundTrip(stored), stored);

  const bigPhoto = `data:image/png;base64,${'A'.repeat(2_400_000)}`;
  const withBig = { ...stored, candidate: { ...stored.candidate, photo: bigPhoto } };
  assert.equal(roundTrip(withBig).candidate.photo, bigPhoto, 'an inline photo up to 2.5 MB is kept');
  assert.equal(roundTrip({ ...stored, candidate: { photo: 'photos/me.jpg' } }).candidate.photo, 'photos/me.jpg', 'a path is kept');

  // Over a cap: the stored value stays and the rest of the section is saved.
  const keep = (field, value) => roundTrip(stored, p => { p.candidate[field] = value; p.candidate.full_name = 'Jane D'; return p; }).candidate;
  for (const bad of [`data:image/png;base64,${'A'.repeat(2_500_001)}`, `data:text/html;base64,${'A'.repeat(100)}`, `photos/${'a'.repeat(1000)}.jpg`]) {
    const candidate = keep('photo', bad);
    assert.equal(candidate.photo, photo, `kept the stored photo over ${bad.slice(0, 20)}`);
    assert.equal(candidate.full_name, 'Jane D');
  }
  const story = roundTrip(stored, p => { p.narrative.exit_story = 'x'.repeat(10_001); p.narrative.headline = 'New'; return p; }).narrative;
  assert.equal(story.exit_story, stored.narrative.exit_story);
  assert.equal(story.headline, 'New');
  const metric = roundTrip(stored, p => { p.narrative.proof_points[0].hero_metric = 'x'.repeat(2001); return p; }).narrative;
  assert.deepEqual(metric.proof_points, stored.narrative.proof_points, 'a list with one item over its cap is not stored at all');
  assert.equal(roundTrip(stored, p => { p.narrative.superpowers.push('x'.repeat(2001)); return p; }).narrative.superpowers.length, 1);
});

test('sanitizeProfileInput: caps per kind of value, and whole-key drops where the merge replaces the key', () => {
  assert.equal(sanitizeProfileInput({ candidate: { email: 'e'.repeat(1000) } }).candidate.email.length, 1000);
  assert.deepEqual(sanitizeProfileInput({ candidate: { email: 'e'.repeat(1001) } }), { candidate: {} });
  assert.equal(sanitizeProfileInput({ narrative: { superpowers: ['s'.repeat(2000)] } }).narrative.superpowers[0].length, 2000);
  assert.deepEqual(sanitizeProfileInput({ narrative: { superpowers: ['s'.repeat(2001)] } }), { narrative: {} });
  assert.equal(sanitizeProfileInput({ search: { must_haves: Array(50).fill('a') } }).search.must_haves.length, 50);
  assert.deepEqual(sanitizeProfileInput({ search: { must_haves: Array(51).fill('a') } }), { search: {} });
  assert.deepEqual(sanitizeProfileInput({ candidate: { x: { a: { b: { c: 1 } } } } }).candidate.x, { a: { b: { c: 1 } } });
  assert.deepEqual(sanitizeProfileInput({ candidate: { x: { a: { b: { c: { d: 1 } } } } } }), { candidate: {} }, 'too deep is left out, not pruned');
  const wide = Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`k${i}`, 'v']));
  assert.deepEqual(sanitizeProfileInput({ candidate: wide, narrative: { headline: 'h' } }), { narrative: { headline: 'h' } });

  // Top-level keys are replaced whole by the merge: any part over a cap drops the key.
  const stored = { candidate: { full_name: 'Jane' }, cover_letter: { primary_domain: 'fintech', note: 'n' } };
  const input = sanitizeProfileInput({ cover_letter: { primary_domain: 'health', note: 'n'.repeat(10_001) }, spend_tier: 's'.repeat(1001) });
  assert.deepEqual(input, {});
  assert.deepEqual(mergeProfileSections(stored, input).cover_letter, stored.cover_letter);
  assert.deepEqual(sanitizeProfileInput({ full_name: 'n'.repeat(1001), email: 'jane@x.io' }), { email: 'jane@x.io' });
  assert.deepEqual(sanitizeProfileInput({ location_prefs: { city: 'c'.repeat(1001), country: 'France' } }), { location_prefs: { country: 'France' } });
});

test('sanitizeProfileInput and the merge never store an account block', () => {
  assert.equal(hasOwnKey(sanitizeProfileInput({ account: { updated_at: '2026-10-09T10:00:00Z' }, candidate: { full_name: 'J' } }), 'account'), false);
  const merged = mergeProfileSections({ ...YAML_PROFILE, account: { updated_at: 'x' } }, { account: { is_admin: true }, candidate: { full_name: 'J' } });
  assert.equal(hasOwnKey(merged, 'account'), false);
  assert.equal(merged.candidate.full_name, 'J');
});

test('config/profile.example.yml survives a save round-trip unchanged', () => {
  const example = yamlLoad(readFileSync(join(ROOT, 'config/profile.example.yml'), 'utf8'));
  assert.deepEqual(roundTrip(example), normalizeProfileRow(example));
});

test('years of experience: 0 is an answer in the form, not in a CV parse', () => {
  assert.equal(yearsFromValue(0), '');
  assert.equal(yearsFromValue(0, { allowZero: true }), 0);
  assert.equal(yearsFromValue('0', { allowZero: true }), 0);
  assert.equal(yearsFromValue('', { allowZero: true }), '');
  assert.equal(yearsFromValue(-1, { allowZero: true }), '');
  assert.equal(yearsFromValue(0.4), '', 'rounds to 0 before the check');
  assert.equal(sanitizeProfileInput({ candidate: { years_experience: 0 } }).candidate.years_experience, 0);
  assert.equal(sanitizeProfileInput({ candidate: { years_experience: '0' } }).candidate.years_experience, 0);
  assert.equal(sanitizeProfileInput({ candidate: { years_experience: '' } }).candidate.years_experience, '');
  assert.equal(coerceParsedProfile({ candidate: { years_experience: 0 } }).candidate.years_experience, '');
  assert.equal(coerceParsedProfile({ candidate: { years_experience: '0 years' } }).candidate.years_experience, '');
});

test('work authorization needs an answer, not the form default', () => {
  const auth = location => computeProfileStatus({ candidate: { full_name: 'J' }, location }, 'cv').checks.work_authorization;
  assert.equal(auth({ needs_sponsorship: false }), false, 'an untouched checkbox is not an answer');
  assert.equal(auth({ needs_sponsorship: true }), true);
  assert.equal(auth({ visa_status: 'EU citizen' }), true);
  assert.equal(auth({ authorized_in: ['France'] }), true);
  assert.equal(auth({}), false);
});

const SAMPLE_CV = `# Jane Doe

**Email:** jane@example.com
**Location:** Lyon, France

## Summary

Backend engineer with nine years on payment platforms.

## Experience

### Acme Payments
**Staff Engineer**
2021 – Present
- Led the migration of the ledger to event sourcing (-40% incidents)
- Mentored 6 engineers

### Globex
**Senior Engineer**
2017 – 2021
- Built the fraud scoring service

## Projects

### [Open Ledger](https://github.com/jane/ledger)
Open-source double-entry ledger
- 2K stars

## Education

- MSc Computer Science — INSA Lyon (2016)

## Skills

- **Languages:** Go, Python, SQL
- **Infra:** Kubernetes, Postgres, Kafka

## Languages

- French (native)
- English (C1)
`;

test('parseCvMarkdownForTemplate reads the cv.md layout AGENTS.md asks for', () => {
  const parsed = parseCvMarkdownForTemplate(SAMPLE_CV);
  assert.equal(parsed.summary, 'Backend engineer with nine years on payment platforms.');
  assert.equal(parsed.experience.length, 2);
  assert.deepEqual(parsed.experience[0], { company: 'Acme Payments', role: 'Staff Engineer', period: '2021 – Present', bullets: ['Led the migration of the ledger to event sourcing (-40% incidents)', 'Mentored 6 engineers'] });
  assert.equal(parsed.experience[1].company, 'Globex');
  assert.deepEqual(parsed.education, [{ degree: 'MSc Computer Science', school: 'INSA Lyon', year: '2016' }]);
  assert.deepEqual(parsed.skill_sections, [
    { title: 'Languages', items: ['Go', 'Python', 'SQL'] },
    { title: 'Infra', items: ['Kubernetes', 'Postgres', 'Kafka'] },
  ]);
  assert.equal(parsed.projects.length, 1);
  assert.equal(parsed.projects[0].name, 'Open Ledger');
  assert.equal(parsed.projects[0].url, 'https://github.com/jane/ledger');
  assert.equal(parsed.projects[0].desc, 'Open-source double-entry ledger');
  assert.deepEqual(parsed.languages, [{ name: 'French', level: 'native' }, { name: 'English', level: 'C1' }]);
});

test('parseCvMarkdownForTemplate also accepts "Role — Company" headings', () => {
  const parsed = parseCvMarkdownForTemplate('# X\n\n## Work history\n\n### Product Designer — Initech\n2019 - 2022\n- Redesigned onboarding\n');
  assert.deepEqual(parsed.experience, [{ company: 'Initech', role: 'Product Designer', period: '2019 - 2022', bullets: ['Redesigned onboarding'] }]);
});

test('buildCvTemplateDataFromProfile renders an account from its own profile, never the owner', () => {
  const profile = normalizeProfileRow(ROW);
  const data = buildCvTemplateDataFromProfile(profile, SAMPLE_CV);
  assert.equal(data.shared.contact.name, 'Jane Doe');
  assert.equal(data.shared.contact.email, 'jane@example.com');
  assert.equal(data.shared.contact.linkedin_url, 'https://linkedin.com/in/janedoe');
  assert.equal(data.shared.contact.github, 'github.com/jane');
  assert.equal(data.profile.headline, 'Backend lead');
  assert.equal(data.profile.summary, 'Backend engineer with nine years on payment platforms.');
  assert.equal(data.profile.experience.length, 2);
  assert.equal(data.profile.tool_logos_hidden, true);
  assert.equal(data.profile.portrait, '');
  assert.deepEqual(data.profile.highlights, ['Go']);
  assert.deepEqual(data.profile.target_roles, ['Senior Backend Engineer']);
  assert.ok(data.profile.availability_tags.some(t => t.label === 'Full remote'));
  assert.ok(data.profile.stats.some(s => s.value === '9+'));
  assert.deepEqual(data.shared.languages, [{ name: 'French', level: 'native', flag: '' }]);
  assert.equal(data.shared.education[0].school, 'INSA Lyon');
  assert.equal(data.profile.phone, '+33 6 00 00 00 00');
  assert.equal(data.profile.phone_link, '+33600000000');
});

test('buildCvTemplateDataFromProfile honours tailored overrides and empty input', () => {
  const data = buildCvTemplateDataFromProfile({}, '', { profile: { summary: 'Tailored' }, shared: { contact: { location: 'Remote' } } });
  assert.equal(data.profile.summary, 'Tailored');
  assert.equal(data.shared.contact.location, 'Remote');
  assert.deepEqual(data.profile.experience, []);
  assert.deepEqual(data.profile.projects, []);
  assert.equal(data.profile.headline, '');
});

test('parseCvMarkdownForTemplate keeps underscores inside words and strips only emphasis', () => {
  const parsed = parseCvMarkdownForTemplate('# X\n\n## Skills\n\n- **Data:** scikit_learn, pandas, *Spark*\n\n## Experience\n\n### Acme_Corp\n**Lead *Data* Engineer**\n2020 - 2022\n- Profile at github.com/jane_doe, `snake_case` APIs\n- *Shipped* the __new__ pipeline\n');
  assert.deepEqual(parsed.skill_sections, [{ title: 'Data', items: ['scikit_learn', 'pandas', 'Spark'] }]);
  assert.equal(parsed.experience[0].company, 'Acme_Corp');
  assert.equal(parsed.experience[0].role, 'Lead Data Engineer');
  assert.deepEqual(parsed.experience[0].bullets, ['Profile at github.com/jane_doe, snake_case APIs', 'Shipped the new pipeline']);
});

test('buildCvTemplateDataFromProfile escapes HTML: the template engine does not', () => {
  const data = buildCvTemplateDataFromProfile(
    { candidate: { full_name: "O'Brien <x>", portfolio_url: 'https://x.dev/?a=1&b="2"' } },
    '# X\n\n## Experience\n\n### A&B\n**Dev**\n2020 - 2021\n- <script>alert(1)</script> cut churn to <5% (R&D)\n',
  );
  assert.equal(data.shared.contact.name, 'O&#39;Brien &lt;x&gt;');
  assert.equal(data.profile.experience[0].company, 'A&amp;B');
  assert.equal(data.profile.experience[0].bullets[0], '&lt;script&gt;alert(1)&lt;/script&gt; cut churn to &lt;5% (R&amp;D)');
  assert.ok(!data.shared.contact.portfolio.includes('"'), 'no raw quote can break out of an href');
});
