// tests/jev-account-error.test.mjs — an empty OpenRouter balance stops Jev
// after the first 402 and the scan result says why (2026-10-02: 120 calls,
// 120 × HTTP 402, and the UI only showed "non qualifiées").
import { pass, fail } from './helpers.mjs';

console.log('\nJev — account errors stop the roster');

// Set before the import: jev.mjs reads the key at load, and dotenv never
// overrides a variable that is already set. fetch is stubbed, nothing leaves.
process.env.OPENROUTER_API_KEY = 'test-key';
let calls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async () => {
  calls += 1;
  await new Promise(resolve => setTimeout(resolve, 5));
  return new Response(JSON.stringify({ error: { message: 'Insufficient credits', code: 402 } }), { status: 402 });
};

try {
  const { filterScanCandidatesWithJev, buildJevScanResponse, jevErrorSummary, isJevAccountError } = await import('../lib/jev.mjs');
  const candidates = Array.from({ length: 30 }, (_, i) => ({ url: `https://jobs.example.com/${i}`, title: `Product Designer ${i}` }));
  const result = await filterScanCandidatesWithJev(candidates, {}, { concurrency: 6 });

  if (calls <= 6) pass(`stops calling after the first 402 (${calls} call(s) for 30 candidates)`);
  else fail(`expected at most 6 calls, got ${calls}`);

  if (result.unverified.length === 30 && result.kept.length === 0) pass('every candidate stays unverified, none validated');
  else fail(`expected 30 unverified / 0 kept, got ${result.unverified.length} / ${result.kept.length}`);

  if (result.unverified.every(candidate => /HTTP 402/.test(candidate.jevError))) pass('skipped candidates carry the 402 as their reason');
  else fail('a skipped candidate lost the 402 reason');

  const response = buildJevScanResponse({ ...result, kept: [], review: [] });
  if (/crédits OpenRouter épuisés \(HTTP 402\)/.test(response.split('\n')[0])) pass('scan result opens with the credits message');
  else fail(`scan result does not name the 402: ${response.split('\n')[0]}`);

  if (!buildJevScanResponse({ kept: [], dropped: [], unverified: [], considered: 0 }).startsWith('⚠️')) pass('no warning line when no call failed');
  else fail('warning line printed without errors');

  if (isJevAccountError('Jev Decisions HTTP 401: bad key') && !isJevAccountError('Jev Decisions HTTP 500: upstream')) pass('401/402 stop the roster, a 500 does not');
  else fail('isJevAccountError misclassifies 401/500');

  if (/Jev en erreur sur 1 appel/.test(jevErrorSummary([{ error: 'The operation was aborted due to timeout' }]))) pass('other errors are summarized with their message');
  else fail('generic error summary missing');
} finally {
  globalThis.fetch = realFetch;
}
