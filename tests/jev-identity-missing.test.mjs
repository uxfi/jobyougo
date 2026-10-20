// tests/jev-identity-missing.test.mjs — an offer with no title or company is
// never dropped for that alone (2026-10-20, Hugo: « si y a pas de nom, il doit
// pas écarter bêtement »). Real cases: Mozilla greenhouse 8153352 added with an
// empty title, RoomPriceGenie ?ashby_jid= with no title (Jev 0.32), rows
// titled "remote:review" or "Choisir le service public" dropped at 0.08-0.46.
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail } from './helpers.mjs';

console.log('\nJev — missing identity is not a reject');

process.env.OPENROUTER_API_KEY = 'test-key';
process.env.AI_USAGE_LOG_PATH = join(tmpdir(), `jev-identity-${process.pid}.jsonl`);
const realFetch = globalThis.fetch;
const states = [];
globalThis.fetch = async (_url, init) => {
  states.push(JSON.parse(init.body).state);
  return new Response(JSON.stringify({ model: 'test', id: 't', answers: { keep: { type: 'noul', noul: 0.05 }, fit: { type: 'score', score: 0.1 }, worth_evaluating: { type: 'noul', noul: 0.05 } } }), { status: 200 });
};

const targeting = {
  primaryRoles: ['Senior Product Designer'],
  archetypes: [{ name: 'Product Designer', level: 'Senior/Lead', fit: 'primary' }, { name: 'Product Manager', level: 'Product scope dependent', fit: 'secondary' }],
  searchTerms: ['Design Lead'],
  rejectInternships: true,
};
const profileRules = { targeting, search: { contractTypes: ['Contract', 'CDI'] } };

try {
  const { isMissingTitle, identityFromUrlSlug, completePostingIdentity } = await import('../lib/posting-identity.mjs');
  const { evaluateCandidate, IDENTITY_MISSING } = await import('../lib/scan-decision.mjs');
  const { filterScanCandidatesWithJev, decideOfferWorthEvaluating } = await import('../lib/jev.mjs');

  if (['', '?', 'remote:review', 'Choisir le service public', 'MyCareersFuture Singapore', '$70/hr'].every(isMissingTitle) && !isMissingTitle('Product Designer')) pass('placeholder titles read as missing, a role does not');
  else fail('isMissingTitle misreads a placeholder or a role');

  const slug = identityFromUrlSlug('https://hr.amplify.xyz/apply/amplify-hr-ai-enabled-project-manager-sfirg');
  if (/Project Manager/.test(slug.title) && slug.company === 'Amplify') pass(`URL slug gives a title and the host a company (${slug.title} / ${slug.company})`);
  else fail(`slug identity: ${JSON.stringify(slug)}`);

  const rpg = completePostingIdentity({ url: 'https://roompricegenie.com/careers/?ashby_jid=1a8e6c59-9eb5-4d62-94f9-871fc9a7c0d4' });
  if (rpg.company === 'Roompricegenie' && rpg.missingTitle) pass('career page with ?ashby_jid= names the company from the host');
  else fail(`career page identity: ${JSON.stringify(rpg)}`);

  const moz = completePostingIdentity({ url: 'https://job-boards.greenhouse.io/mozilla/jobs/8153352?gh_src=6eba76201us', jdText: 'Company: mozilla\nRole: Senior Product Designer, Firefox\n' });
  if (moz.title === 'Senior Product Designer, Firefox' && moz.company === 'Mozilla') pass('JD metadata block fills an empty Mozilla row');
  else fail(`mozilla identity: ${JSON.stringify(moz)}`);

  const scan = evaluateCandidate({ title: '', url: 'https://jobs.example.com/x', remoteEvidence: 'Remote', location: 'Remote' }, { title_filter: { positive: ['product designer'] } }, { today: '2026-10-20' });
  if (scan.disposition !== 'reject' || scan.reasonCode !== 'title') pass(`scan: the title filter does not reject an empty title (${scan.disposition}/${scan.reasonCode})`);
  else fail('scan title filter rejected an empty title');
  const scanKeep = evaluateCandidate({ title: '', url: 'https://jobs.example.com/x', remoteEvidence: 'Fully remote, work from anywhere', location: 'Remote - Worldwide', publishedAt: '2026-10-19' }, { title_filter: { positive: ['product designer'] } }, { today: '2026-10-20' });
  if (scanKeep.disposition !== 'keep' && (scanKeep.disposition === 'reject' || scanKeep.reasons.includes(IDENTITY_MISSING) || scanKeep.disposition === 'review')) pass(`scan: an untitled posting is never a strict keep (${scanKeep.disposition})`);
  else fail(`untitled posting: ${JSON.stringify(scanKeep)}`);

  const result = await filterScanCandidatesWithJev([
    { url: 'https://roompricegenie.com/careers/?ashby_jid=1a8e6c59', title: '', company: '' },
    { url: 'https://www.coroflot.com/x/jobs/2', title: 'remote:review', company: '' },
    { url: 'https://jobs.example.com/3', title: 'Head of Sales', company: 'Acme' },
  ], profileRules, { concurrency: 1 });
  const review = result.kept.filter(c => c.jevReason === 'identity missing' && c.disposition === 'review');
  if (review.length === 2) pass('Jev: untitled rows below threshold go to review, not dropped');
  else fail(`identity review: ${JSON.stringify(result.kept.map(c => [c.url, c.jevReason]))}`);
  if (result.dropped.length === 1 && result.dropped[0].title === 'Head of Sales') pass('Jev: a titled off-target row is still dropped');
  else fail(`dropped: ${result.dropped.map(c => c.title).join(', ')}`);
  if (states.every(state => state.title !== 'remote:review') && states[0].company === 'Roompricegenie') pass('Jev reads the recovered company, never a placeholder title');
  else fail(`states sent to Jev: ${JSON.stringify(states.map(s => [s.title, s.company]))}`);

  const gate = await decideOfferWorthEvaluating({ title: '', company: '', url: 'https://example.org/p/123', jdText: 'We are hiring someone to shape our app. Remote. '.repeat(30), profileRules });
  if (gate.pass && /identity missing/.test(gate.override)) pass('eval gate: no title, JD present → full evaluation, not a hard pass');
  else fail(`untitled gate: ${JSON.stringify(gate)}`);
  const titled = await decideOfferWorthEvaluating({ title: 'Head of Sales', company: 'Acme', url: 'https://example.org/p/9', jdText: 'Sell things. '.repeat(50), profileRules });
  if (!titled.pass) pass('eval gate: a titled off-target offer is still a hard pass');
  else fail('titled off-target passed');
} finally {
  globalThis.fetch = realFetch;
}
