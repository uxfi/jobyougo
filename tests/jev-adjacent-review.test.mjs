// tests/jev-adjacent-review.test.mjs — Jev's role-interest call is a hint:
// a design role next to the primary product-design archetypes that Jev scores
// below threshold goes to the review bin, never to the drop list
// (2026-10-20: UX/UI Designer Pi R Square 0.28, Product Designer MindFi 0.18,
// Senior Product Designer, Docs Coda 0.09). Other trades stay dropped.
import { pass, fail } from './helpers.mjs';

console.log('\nJev — adjacent design roles go to review, not dropped');

import { tmpdir } from 'os';
import { join } from 'path';

process.env.OPENROUTER_API_KEY = 'test-key';
// The stubbed answers must not land in the real AI usage ledger.
process.env.AI_USAGE_LOG_PATH = join(tmpdir(), `jev-adjacent-${process.pid}.jsonl`);
const realFetch = globalThis.fetch;
// Every Jev answer is a low keep (0.1): only the deterministic rules decide.
globalThis.fetch = async () => new Response(JSON.stringify({
  model: 'test', id: 't', answers: { keep: { type: 'noul', noul: 0.1 }, fit: { type: 'score', score: 0.2 }, worth_evaluating: { type: 'noul', noul: 0.1 } },
}), { status: 200 });

const targeting = {
  primaryRoles: ['Senior Product Designer', 'Lead Product Designer', 'AI Product Designer'],
  archetypes: [
    { name: 'Product Designer', level: 'Senior/Lead', fit: 'primary' },
    { name: 'UX/UI Designer', level: 'Senior', fit: 'primary' },
    { name: 'Product Manager', level: 'Product scope dependent', fit: 'secondary' },
  ],
  searchTerms: ['Design Lead', 'Head of Design', 'Design Engineer'],
  rejectInternships: true,
};
const profileRules = { targeting, search: { contractTypes: ['Contract', 'CDI'] } };
const opts = { contractTypes: ['Contract', 'CDI'], targeting };

try {
  const { adjacentDesignRoleReason, jevDropOverrideReason, jevEvalOverrideReason } = await import('../lib/scan-decision.mjs');
  const { filterScanCandidatesWithJev, decideOfferWorthEvaluating } = await import('../lib/jev.mjs');

  const adjacent = ['Vice President, Experience Designer', 'Senior Interaction Designer', 'Design Manager', 'Senior UX Researcher', 'Product & Design Lead', 'Staff Design Systems Designer'];
  const missing = adjacent.filter(title => !adjacentDesignRoleReason({ title, url: 'https://jobs.example.com/1' }, opts) && !jevDropOverrideReason({ title, url: 'https://jobs.example.com/1' }, opts));
  if (!missing.length) pass('adjacent design titles are kept from the drop list');
  else fail(`adjacent titles still dropped: ${missing.join(', ')}`);

  const otherTrades = ['CPU Clock Design Lead', 'Senior Electrical Design Engineer', 'Physical Design Engineer', 'Civil Design Engineer H/F', 'Learning Experience Designer', 'Lead Editorial Designer', 'Design Manager (Sports/Lifestyle Apparel)', 'Graphic designer - Remote', 'Head of Product Marketing'];
  const leaked = otherTrades.filter(title => adjacentDesignRoleReason({ title, url: 'https://jobs.example.com/2' }, opts) || jevDropOverrideReason({ title, url: 'https://jobs.example.com/2' }, opts));
  if (!leaked.length) pass('other "design" trades and non-design roles stay a Jev decision');
  else fail(`non-product design titles escaped: ${leaked.join(', ')}`);

  const blockers = ['Junior UX Designer', 'UX Designer Intern', 'Experience Designer (Hybrid)', 'What is a Fractional Design Leader?', 'Hire a Lead UX Designer'];
  const notBlocked = blockers.filter(title => adjacentDesignRoleReason({ title, url: 'https://jobs.example.com/3' }, opts));
  if (!notBlocked.length) pass('junior, intern, title-level hybrid and article pages are not rescued');
  else fail(`rescued despite a hard blocker: ${notBlocked.join(', ')}`);

  const result = await filterScanCandidatesWithJev([
    { url: 'https://jobs.example.com/a', title: 'Vice President, Experience Designer', company: 'BNY' },
    { url: 'https://jobs.example.com/b', title: 'Staff Logic Design Engineer', company: 'Intel' },
    { url: 'https://jobs.example.com/c', title: 'Senior Product Designer', company: 'Coda' },
  ], profileRules, { concurrency: 1 });
  const review = result.kept.filter(c => c.disposition === 'review');
  if (review.length === 1 && review[0].title.startsWith('Vice President') && review[0].jevOutcome === 'review' && review[0].jevReason === 'adjacent design role') pass('scan: adjacent role below threshold lands in the review bin');
  else fail(`expected 1 review, got ${JSON.stringify(review.map(c => [c.title, c.jevOutcome]))}`);
  if (result.dropped.length === 1 && /Logic Design/.test(result.dropped[0].title)) pass('scan: chip design engineer stays dropped');
  else fail(`dropped: ${result.dropped.map(c => c.title).join(', ')}`);
  if (result.kept.some(c => c.title === 'Senior Product Designer' && c.disposition !== 'review')) pass('scan: primary family still force-validated');
  else fail('primary family no longer validated');

  const codaJd = 'We are a product company. Our remote-first, hybrid model enables a highly collaborative culture. You will own the Docs design.';
  if (jevEvalOverrideReason({ title: 'Senior Product Designer, Docs', url: 'https://jobs.example.com/d', jdText: codaJd, ...opts })) pass('eval gate: "remote-first, hybrid model" no longer cancels the role-family override');
  else fail('remote-first hybrid JD still blocks the override');
  const lockedJd = 'This is a hybrid role: you must be in our Ho Chi Minh City office three days a week.';
  if (!jevEvalOverrideReason({ title: 'Product Designer - UI and Design System expert', url: 'https://jobs.example.com/e', jdText: lockedJd, ...opts })) pass('eval gate: a verbatim hybrid requirement still blocks it');
  else fail('verbatim hybrid requirement overridden');

  const gate = await decideOfferWorthEvaluating({ title: 'Senior Interaction Designer', url: 'https://jobs.example.com/f', jdText: 'Fully remote design team. Shape the interaction model of our AI product.', profileRules });
  if (gate.pass && /adjacent design role/.test(gate.override)) pass('eval gate: adjacent role passes to the full evaluation instead of a hard pass');
  else fail(`adjacent role gate: ${JSON.stringify(gate)}`);
} finally {
  globalThis.fetch = realFetch;
}
