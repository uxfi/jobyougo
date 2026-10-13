import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCandidateProfileState,
  buildJevScanResponse,
  candidateArchetypes,
  candidateTargetLevel,
  evalGateQuestions,
  noulFromAnswers,
  scanKeepQuestions,
  scoreFromAnswers,
} from '../lib/jev.mjs';
import { extractScanEntriesFromResponse, isScanSelectionComplete } from '../lib/scan-parse.mjs';

test('noulFromAnswers / scoreFromAnswers read Decisions payload', () => {
  const answers = {
    keep: { type: 'noul', noul: 0.81 },
    fit: { type: 'score', score: 1.4 },
  };
  assert.equal(noulFromAnswers(answers, 'keep'), 0.81);
  assert.equal(scoreFromAnswers(answers, 'fit'), 1.4);
  assert.equal(noulFromAnswers({}, 'keep'), null);
});

test('buildCandidateProfileState maps profile rules', () => {
  const state = buildCandidateProfileState(
    { title: 'PM', company: 'Acme', location: 'Remote EU', url: 'https://example.com/1' },
    {
      location: { authorizedIn: ['France', 'EU'], fullRemoteOnly: true, remotePolicy: 'full remote' },
      targeting: { primaryRoles: ['AI Product Manager'] },
      search: { mustHaves: ['remote'], dealBreakers: ['US only'] },
    }
  );
  assert.equal(state.title, 'PM');
  assert.deepEqual(state.candidate_authorized_in, ['France', 'EU']);
  assert.equal(state.candidate_full_remote_only, true);
  assert.deepEqual(state.candidate_target_roles, ['AI Product Manager']);
});

// Same shape inferProfileMatchingRules (ui/server.mjs) builds from
// config/profile.yml in 2026-10: design archetypes primary, PM secondary.
const designFirstRules = {
  location: { authorizedIn: ['France', 'European Union', 'Thailand'], fullRemoteOnly: true, remotePolicy: 'Full remote required' },
  targeting: {
    primaryRoles: ['Senior Product Designer', 'Lead Product Designer', 'AI Product Designer', 'Founding Product Designer', 'AI Product Builder'],
    archetypes: [
      { name: 'Product Designer', level: 'Senior/Lead', fit: 'primary' },
      { name: 'UX/UI Designer', level: 'Senior', fit: 'primary' },
      { name: 'AI Product Builder', level: 'Senior', fit: 'primary' },
      { name: 'Product Manager', level: 'Product scope dependent', fit: 'secondary' },
    ],
    yearsExperience: 12,
  },
  search: {
    contractTypes: ['Salaried'],
    sectorPreferences: ['AI / SaaS'],
    mustHaves: ['Full remote'],
    dealBreakers: ['US-only remote'],
  },
  compensation: { minimum: 'EUR60K salary / EUR500/day', targetRange: 'EUR70K-110K' },
};

test('buildCandidateProfileState passes archetypes, level, contract, sector and pay floor', () => {
  const state = buildCandidateProfileState({ title: 'Product Pricing Manager', url: 'https://example.com/2' }, designFirstRules);
  assert.deepEqual(state.candidate_archetypes, [
    'Product Designer — level: Senior/Lead — fit: primary',
    'UX/UI Designer — level: Senior — fit: primary',
    'AI Product Builder — level: Senior — fit: primary',
    'Product Manager — level: Product scope dependent — fit: secondary',
  ]);
  assert.equal(state.candidate_target_level, 'Senior/Lead');
  assert.deepEqual(state.candidate_contract_types, ['Salaried']);
  assert.deepEqual(state.candidate_sector_preferences, ['AI / SaaS']);
  assert.equal(state.candidate_compensation_minimum, 'EUR60K salary / EUR500/day');
  // Strings only: the Decisions API already takes the other candidate_* lists.
  assert.ok(state.candidate_archetypes.every(entry => typeof entry === 'string'));
});

test('candidateTargetLevel reads primary archetypes, then role titles, then an explicit value', () => {
  assert.equal(candidateTargetLevel(designFirstRules.targeting), 'Senior/Lead');
  assert.equal(candidateTargetLevel({ primaryRoles: ['Staff Data Engineer', 'Principal Data Engineer'] }), 'Staff/Principal');
  assert.equal(candidateTargetLevel({ targetLevel: 'Lead', archetypes: designFirstRules.targeting.archetypes }), 'Lead');
  assert.equal(candidateTargetLevel({}), '');
});

test('candidateArchetypes keeps primary and folds anything else into secondary', () => {
  assert.deepEqual(
    candidateArchetypes({ archetypes: [{ name: 'Product Designer', level: 'Senior', fit: 'Primary' }, { name: 'PM', fit: '' }, { name: '' }] }),
    [{ name: 'Product Designer', level: 'Senior', fit: 'primary' }, { name: 'PM', level: '', fit: 'secondary' }],
  );
});

test('Jev questions read the roles from the state instead of a hardcoded PM keep list', () => {
  const keep = scanKeepQuestions().keep.instructions;
  const gate = evalGateQuestions().worth_evaluating.instructions;
  for (const text of [keep, gate]) {
    assert.match(text, /candidate_archetypes/);
    assert.match(text, /candidate_target_level/);
    assert.match(text, /fit: secondary/);
    assert.match(text, /Product Pricing Manager, Product Assurance Manager, Technical Product Owner/);
    assert.match(text, /assistant, mid-level/);
    assert.match(text, /Web Designer/);
    assert.match(text, /candidate_compensation_minimum/);
    // Rules kept from the previous text.
    assert.match(text, /remote_disposition/);
    assert.match(text, /I-9, E-Verify/);
    assert.doesNotMatch(text, /Product Manager, Product Lead, UX Designer and nearby titles are a role-family match/);
    assert.doesNotMatch(text, /Prefer yes for Product Design \/ Product Designer \/ Product Manager/);
  }
  assert.match(keep, /Welcome to the Jungle URL/);
  assert.match(gate, /outside Thailand only with a verbatim attendance requirement/);
});

test('buildJevScanResponse is parseable by extractScanEntriesFromResponse', () => {
  const text = buildJevScanResponse({
    considered: 2,
    dropped: [{ url: 'https://example.com/drop' }],
    kept: [
      {
        url: 'https://example.com/keep',
        title: 'Senior Product Manager',
        company: 'SafetyWing',
        publishedAt: '2026-09-19',
        jevKeep: 0.9,
        jevFit: 1.7,
      },
    ],
  });
  assert.equal(isScanSelectionComplete(text), true);
  const entries = extractScanEntriesFromResponse(text);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].url, 'https://example.com/keep');
  assert.match(entries[0].note, /SafetyWing/);
});

test('buildJevScanResponse empty → AUCUNE', () => {
  const text = buildJevScanResponse({ kept: [], dropped: [], considered: 0 });
  assert.match(text, /AUCUNE/);
  assert.equal(extractScanEntriesFromResponse(text).length, 0);
});
