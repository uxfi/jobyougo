import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCandidateProfileState,
  buildJevScanResponse,
  noulFromAnswers,
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
