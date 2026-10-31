// Discovery follow-ups: profile-driven explorer terms and title gate, careers-page
// board hints in the resolver, and pruning of auto-added boards that stay empty.
import test from 'node:test';
import assert from 'node:assert/strict';
import { explorerTerms, buildExplorerQueries, classifyCandidate, EXPLORER_ROLE_TERMS } from '../lib/ats-explorer.mjs';
import { pageBoardHints, pruneEmptyAutoBoards, resolveCompanyBoard } from '../lib/ats-board-resolver.mjs';

const html = (body) => async () => ({ status: 200, text: async () => body });

test('explorerTerms: ats_explorer.role_terms, then profile positives, then the tech default', () => {
  assert.deepEqual(explorerTerms({ ats_explorer: { role_terms: ['Nurse'] }, title_filter: { positive: ['Chef'] } }), ['"Nurse"']);
  assert.deepEqual(explorerTerms({ title_filter: { positive: ['Product Designer', 'UX Researcher'] } }), ['"Product Designer"', '"UX Researcher"']);
  assert.deepEqual(explorerTerms({ title_filter: { positive: ['^dev(eloper)?$'] } }), EXPLORER_ROLE_TERMS);
  assert.deepEqual(explorerTerms({}), EXPLORER_ROLE_TERMS);
});

test('buildExplorerQueries uses the given terms', () => {
  const { queries } = buildExplorerQueries({ cursor: 0, budget: 3, terms: ['"Nurse"'] });
  assert.equal(queries.length, 3);
  assert.ok(queries.every((q) => q.endsWith('"Nurse"')));
});

test('classifyCandidate: a profile title filter replaces the tech/product list', () => {
  const titleFilter = { positive: ['nurse'], negative: ['intern'] };
  assert.equal(classifyCandidate({ slug: 'clinic-x', titles: ['Registered Nurse', 'Nurse Manager'], titleFilter }).ok, true);
  assert.equal(classifyCandidate({ slug: 'acme', titles: ['Software Engineer', 'Product Manager'], titleFilter }).reason, 'no_matching_role');
  assert.equal(classifyCandidate({ slug: 'acme', titles: ['Nurse Intern'], titleFilter }).reason, 'no_matching_role');
  // without a filter the tech list still decides
  assert.equal(classifyCandidate({ slug: 'acme', titles: ['Software Engineer'] }).ok, true);
});

test('pageBoardHints reads ATS links from the company\'s own careers page only', async () => {
  const page = '<a href="https://jobs.lever.co/zeta">Jobs</a><iframe src="https://boards.greenhouse.io/zetaco"></iframe>';
  const hints = await pageBoardHints({ careers_url: 'https://zeta.example/careers' }, { fetchImpl: html(page) });
  assert.deepEqual(hints.map((h) => `${h.ats}|${h.slug}`).sort(), ['greenhouse|zetaco', 'lever|zeta']);
  assert.deepEqual(await pageBoardHints({ careers_url: 'https://jobs.lever.co/zeta' }, { fetchImpl: html(page) }), []);
  assert.deepEqual(await pageBoardHints({ careers_url: 'http://zeta.example/' }, { fetchImpl: html(page) }), []);
  assert.deepEqual(await pageBoardHints({ careers_url: 'https://zeta.example/' }, { fetchImpl: async () => ({ status: 404, text: async () => page }) }), []);
});

test('resolveCompanyBoard falls back on the careers page when no guessed slug matches', async () => {
  const verify = async ({ ats, slug }) => (ats === 'lever' && slug === 'weird-slug'
    ? { status: 200, titles: ['A', 'B', 'C', 'D'], name: null, sample: '' }
    : { status: 404, titles: [], name: null, sample: '' });
  const pageHints = async () => [{ ats: 'lever', slug: 'weird-slug' }];
  const res = await resolveCompanyBoard({ name: 'Zeta Corp', careers_url: 'https://zeta.example/careers' }, { verify, pageHints });
  assert.equal(res.best?.slug, 'weird-slug');
  assert.equal(res.best.verdict.confidence, 'page');
  const none = await resolveCompanyBoard({ name: 'Zeta Corp' }, { verify, pageHints: async () => [] });
  assert.equal(none.best, null);
});

test('pruneEmptyAutoBoards: only auto-added entries, only after empty_days, a refill resets the clock', async () => {
  const tracked = [
    { name: 'Auto Co', careers_url: 'https://jobs.lever.co/autoco', notes: 'auto-explored 2026-10-01 via x' },
    { name: 'Hand Co', careers_url: 'https://jobs.lever.co/handco', notes: 'my pick' },
    { name: 'Off Co', careers_url: 'https://jobs.lever.co/offco', notes: 'auto-resolved 2026-10-01', enabled: false },
  ];
  const state = {};
  const empty = async () => ({ status: 200, titles: [] });
  const day = 86400000;
  const t0 = new Date('2026-10-01T00:00:00Z');
  assert.deepEqual(await pruneEmptyAutoBoards(tracked, { state, now: t0, verify: empty }), []);
  assert.deepEqual(Object.keys(state.empty), ['Auto Co']);
  assert.deepEqual(await pruneEmptyAutoBoards(tracked, { state, now: new Date(t0.getTime() + 10 * day), verify: empty }), []);
  const out = await pruneEmptyAutoBoards(tracked, { state, now: new Date(t0.getTime() + 22 * day), verify: empty });
  assert.equal(out.length, 1);
  assert.equal(out[0].company.name, 'Auto Co');
  // refilled board resets
  await pruneEmptyAutoBoards(tracked, { state, now: new Date(t0.getTime() + 23 * day), verify: async () => ({ status: 200, titles: ['Designer'] }) });
  assert.equal(state.empty['Auto Co'], undefined);
  // an unreachable board is not an empty one
  await pruneEmptyAutoBoards(tracked, { state, now: new Date(t0.getTime() + 24 * day), verify: async () => ({ status: 500, titles: [] }) });
  assert.equal(state.empty['Auto Co'], undefined);
});
