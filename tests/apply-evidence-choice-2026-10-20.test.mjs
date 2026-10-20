// Screening choice questions with no own answer: the model picks from the
// full CV + portfolio evidence, with a reason, and the pick is flagged for
// review. Offline: the LLM is simulated.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveUnknownFields } from '../lib/apply-llm.mjs';
import { portfolioTextFromSource } from '../lib/apply-evidence.mjs';

const spec = { company: 'Darkroom', role: 'Senior Product Designer', identity: { name: 'Hugo V' } };
const career = {
  text: '# Hugo V\n## Shiseido Group — Senior Product Designer (2024)\nGlobal eCommerce platform: product pages, cart and checkout, loyalty.\n## OneAsset — Product lead\nCoded prototypes with Cursor and Claude Code (vibe coding).',
  employers: ['- Shiseido Group — Senior Product Designer (2024)'],
  sideNames: [],
  digest: '',
};
const portfolio = portfolioTextFromSource("{ desc: 'Creads.io: AI advertising SaaS with a Brand Agent', outcome: { en: 'Launched in production' } }");
const fields = [
  { i: 0, label: 'How comfortable are you building with React and TypeScript?', kind: 'choice', required: true,
    options: ['I have shipped production apps as a senior engineer', 'I can build individual components with some help', 'I have never used them'] },
  { i: 1, label: 'Have you designed for e-commerce brands?', kind: 'choice', required: true,
    options: ['Yes, it was the main focus of a past role', 'A little', 'No'] },
  { i: 2, label: 'Walk us through a project you are proud of (pick one)', kind: 'choice', required: true,
    options: ['Project A', 'Project B'] },
];

function fakeChat(reply) {
  const calls = [];
  const fn = async (req) => { calls.push(req.messages.map((m) => m.content).join('\n')); return typeof reply === 'function' ? reply(calls.at(-1)) : reply; };
  fn.calls = calls;
  return fn;
}

test('the prompt carries the full CV, the portfolio and the honesty rules', async () => {
  const chatFn = fakeChat('{}');
  await resolveUnknownFields({ fields, spec, career, portfolio, chatFn });
  const prompt = chatFn.calls.find((p) => /FIELDS/.test(p)) || '';
  assert.match(prompt, /EVIDENCE/);
  assert.match(prompt, /cart and checkout/);
  assert.match(prompt, /Brand Agent/);
  assert.match(prompt, /vibe coding/i);
  assert.match(prompt, /"Daily"/);
  assert.match(prompt, /Every field gets an answer/);
  assert.doesNotMatch(prompt, /\{"pick": null\}/);
});

test('picks map to the real option text and are flagged with their reason', async () => {
  const chatFn = fakeChat(JSON.stringify({
    0: { pick: 1, why: 'builds through AI-assisted vibe coding, not an engineer', source: 'CV: OneAsset' },
    1: { pick: 0, why: 'Shiseido global eCommerce', source: 'CV: Shiseido Group' },
    2: { pick: 0, why: 'Creads.io is the launched product', source: 'portfolio' },
  }));
  const out = await resolveUnknownFields({ fields, spec, career, portfolio, chatFn });
  assert.equal(out['0'], 'I can build individual components with some help');
  assert.equal(out['1'], 'Yes, it was the main focus of a past role');
  assert.equal(out['2'], 'Project A', 'a subjective list still gets the best-supported option');
  assert.match(out.inferred['0'].why, /vibe coding/);
  assert.equal(out.inferred['1'].source, 'CV: Shiseido Group');
  assert.deepEqual(Object.keys(out).sort(), ['0', '1', '2'], 'the review notes are not answers');
});

test('a bare number from an older-style reply still works and is flagged', async () => {
  const out = await resolveUnknownFields({ fields: [fields[1]], spec, career, portfolio, chatFn: fakeChat('{"1": 0}') });
  assert.equal(out['1'], 'Yes, it was the main focus of a past role');
  assert.ok(out.inferred['1']);
});

test('portfolio text keeps English copy and skips paths and colours', () => {
  const t = portfolioTextFromSource("{ title: 'Shiseido', img: './a.png', tag: '#fff', desc: 'Checkout redesign' }");
  assert.match(t, /Shiseido/);
  assert.match(t, /Checkout redesign/);
  assert.doesNotMatch(t, /a\.png|#fff/);
});