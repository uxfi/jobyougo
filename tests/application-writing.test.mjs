import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { polishApplicationAnswer, sanitizeApplicationProse, loadApplicationVoice, extractQuestionReportContext, methodizeProofText, stripMetricClaimsFromProse } from '../lib/application-writing.mjs';

test('editing preserves qualifications, technical terms and proper names', () => {
  for (const text of [
    'I believe the change helped, but we did not measure its effect.',
    'https://example.com/Showcase?team=AI&version=1.2',
    'I showcased the prototype, not the production release.',
  ]) assert.equal(polishApplicationAnswer(text), text);
});

test('sanitizer follows copywriting/humanizer/stop-slop/copy-editing: dashes, stock words, openers', () => {
  assert.equal(
    polishApplicationAnswer('I worked on Leverage, an internal tool, from 2020–2024.'),
    'I worked on Leverage, an internal tool, from 2020-2024.',
  );
  assert.equal(
    polishApplicationAnswer('Je contribuai au prototype ; une collègue pilotait le projet.'),
    'Je contribuai au prototype. Une collègue pilotait le projet.',
  );
  assert.equal(polishApplicationAnswer('EUR 70–110K'), 'EUR 70-110K');
  assert.equal(polishApplicationAnswer('Yes — I would be delighted to relocate.'), 'Yes');
  assert.equal(
    polishApplicationAnswer('I am excited to apply for this role. I shipped hiring tools at Station F.'),
    'I shipped hiring tools at Station F.',
  );
  assert.equal(
    polishApplicationAnswer('We built a robust queue to leverage existing data. That\'s the work I do.'),
    'We built a strong queue to use existing data.',
  );
  assert.equal(
    polishApplicationAnswer('Here\'s the thing. The flow is seamless and cutting-edge.'),
    'The flow is smooth and new.',
  );
  assert.equal(
    sanitizeApplicationProse('I want to delve into the hiring workflow — one flow, real users.'),
    'I want to look at the hiring workflow, one flow, real users.',
  );
});

test('plain text cleanup preserves paragraphs and meaningful lists', () => {
  assert.equal(polishApplicationAnswer('Réponse : **Bonjour**\r\n\r\nUn exemple.\r\n\r\nMerci.'), 'Bonjour\n\nUn exemple.\n\nMerci.');
  assert.equal(polishApplicationAnswer('1. Design\n2. Implementation'), '1. Design\n2. Implementation');
});

test('user voice loads Writing Style and the application-writing custom block', () => {
  const root = mkdtempSync(join(tmpdir(), 'application-writing-'));
  try {
    mkdirSync(join(root, 'modes'));
    writeFileSync(join(root, 'modes/_custom.md'), 'Unrelated workflow\n<!-- application-writing:start -->\nÉcrire sobrement.\n<!-- application-writing:end -->');
    writeFileSync(join(root, 'modes/_profile.md'), '## Primary positioning\nIgnore me.\n\n## Writing Style\nShort sentences. No em dashes.\n');
    const voice = loadApplicationVoice(root);
    assert.match(voice, /Écrire sobrement/);
    assert.match(voice, /Short sentences/);
    assert.doesNotMatch(voice, /Ignore me/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('extractQuestionReportContext drops cover-letter drafts and interview STAR, keeps Match CV', () => {
  const report = `# Evaluation\n\n## A) Role Summary\nJD detail.\n\n## B) Match with CV\nOneAsset sole designer.\n\n## E) Customization Plan\nRewrite the CV.\n\n## F) Interview Plan\nSTAR story dump.\n\n## Cover Letter Draft\nI am excited to apply — leverage a unique blend.\n\n## Application Answers\n**Question:** Why us?\nI shipped Creads.io.\n`;
  const out = extractQuestionReportContext(report);
  assert.match(out, /JD detail/);
  assert.match(out, /OneAsset sole designer/);
  assert.match(out, /I shipped Creads\.io/);
  assert.doesNotMatch(out, /I am excited/);
  assert.doesNotMatch(out, /STAR story dump/);
  assert.doesNotMatch(out, /Rewrite the CV/);
});

test('methodizeProofText keeps method clauses and drops metric/date proof', () => {
  assert.match(
    methodizeProofText('Shipped the full product with one Product Owner: investor app, admin panel. In the first 6 months added OTC.'),
    /investor app/i,
  );
  assert.doesNotMatch(
    methodizeProofText('Shipped the full product with one Product Owner: investor app, admin panel. In the first 6 months added OTC.'),
    /6 months/,
  );
  assert.doesNotMatch(
    methodizeProofText('1,200 registered users, 20 paying clients; founded and built the product from UX through deployment'),
    /1,200|20 paying/,
  );
  assert.match(
    methodizeProofText('1,200 registered users, 20 paying clients; founded and built the product from UX through deployment'),
    /founded and built|UX through deployment/i,
  );
});

test('polish strips metric dumps from long free-text but keeps salary facts', () => {
  assert.equal(polishApplicationAnswer('60000'), '60000');
  assert.equal(polishApplicationAnswer('EUR 70–110K'), 'EUR 70-110K');
  const long = polishApplicationAnswer(
    'I shipped the investor app with a Product Owner. In the first 6 months we also launched OTC. Prototypes ran in Cursor and Claude Code.',
  );
  assert.match(long, /Product Owner|Cursor|Claude Code/i);
  assert.doesNotMatch(long, /6 months/);
  assert.equal(
    stripMetricClaimsFromProse('Short note about Creads.'),
    'Short note about Creads.',
  );
});
