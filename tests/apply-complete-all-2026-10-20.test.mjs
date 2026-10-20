// Hugo: every question is answered (text, lists, subjective, walkthrough),
// from the CV / portfolio / profile / offer. Simulated model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveUnknownFields } from '../lib/apply-llm.mjs';

const career = {
  text: '# Hugo V\n## Shiseido Group — Senior Product Designer (2024)\nGlobal eCommerce platform: checkout and loyalty.\n## OneAsset — Product lead (2025)\nPrototypes coded with Cursor and Claude Code.',
  employers: ['- Shiseido Group — Senior Product Designer (2024)', '- OneAsset — Product lead (2025)'],
  sideNames: [],
  digest: '',
};
const portfolio = 'Creads.io: AI advertising SaaS with a Brand Agent | Shiseido: eCommerce checkout redesign | OneAsset: agent hand-off to Cursor';

// Answers every key in the list prompt with its first option or a short
// value, and writes a paragraph for every free-text prompt.
function fakeModel() {
  const prompts = [];
  const fn = async (req) => {
    const p = req.messages.map((m) => m.content).join('\n');
    prompts.push(p);
    if (/\nFIELDS\n/.test(p)) {
      const keys = [...p.split('\nFIELDS\n')[1].matchAll(/^\[([^\]]+)\]([^\n]*)\n?(\s+OPTIONS)?/gm)];
      return JSON.stringify(Object.fromEntries(keys.map((m) => [m[1], m[3] ? { pick: 0, why: 'closest to the CV', source: 'CV' } : '3 months'])));
    }
    return 'At Shiseido I redesigned the global eCommerce checkout and loyalty flows, and at OneAsset I lead product with prototypes coded in Cursor and Claude Code. Creads.io shows how I design AI agents end to end.';
  };
  fn.prompts = prompts;
  return fn;
}

const choice = (label, options) => ({ label, kind: 'choice', required: true, options });
const darkroom = [
  choice('What is your English level?', ['Basic', 'Professional-Level', 'Fluent / Native-Speaker']),
  choice('How comfortable are you with React and TypeScript?', ['Senior engineer', 'Individual components with some help', 'Never used']),
  choice('Have you designed AI interfaces or agents in production?', ['Yes, I led the design and build of AI features in production', 'Some exposure', 'No']),
  choice('Have you worked on e-commerce or marketing products?', ['Yes, it was the main focus of a past role', 'A little', 'No']),
  choice('How often do you use AI coding tools?', ['Daily', 'Weekly', 'Rarely']),
  choice('Which work style do you prefer?', ['Async-first', 'Mostly meetings']),
  { label: 'Portfolio link + walkthrough', kind: 'text', required: true },
  { label: 'Why Darkroom?', kind: 'long text', required: true },
];
const oradian = [
  { label: 'What is your notice period?', kind: 'text', required: true },
  { label: 'Why do you want to join Oradian?', kind: 'long text', required: true },
  { label: 'Tell us about a time you worked directly with a user', kind: 'text', required: true },
  choice('Pound Sterling (£)', ['Pound Sterling (£)', 'Euro (€)']),
];

for (const [company, form] of [['Darkroom', darkroom], ['Oradian', oradian]]) {
  test(`${company}: no field is left empty`, async () => {
    const spec = { company, role: 'Senior Product Designer', identity: { name: 'Hugo V', portfolio: 'https://jobyougo.xyz/portfolio' } };
    const fields = form.map((f, i) => ({ i, ...f }));
    const chatFn = fakeModel();
    const out = await resolveUnknownFields({ fields, spec, career, portfolio, chatFn });
    const empty = fields.filter((f) => !String([out[String(f.i)]].flat()[0] ?? '').trim()).map((f) => f.label);
    assert.deepEqual(empty, [], `left empty: ${empty.join(' | ')}`);
    for (const p of chatFn.prompts) assert.doesNotMatch(p, /\{"pick": null\}|omit that field so the candidate/);
  });
}

test('the portfolio walkthrough starts with the portfolio link and is flagged for review', async () => {
  const spec = { company: 'Darkroom', role: 'Designer', identity: { portfolio: 'https://jobyougo.xyz/portfolio' } };
  const out = await resolveUnknownFields({ fields: [{ i: 0, label: 'Portfolio link + walkthrough', kind: 'text', required: true }], spec, career, portfolio, chatFn: fakeModel() });
  assert.match(out['0'], /^https:\/\/jobyougo\.xyz\/portfolio/);
  assert.match(out['0'], /Shiseido|Creads/);
  assert.ok(out.inferred['0']);
});
// Non-regression against the behaviour before 6c6405fb.
test('before 6c6405fb kept: an open question is still written by the model with its own text', async () => {
  const spec = { company: 'Oradian', role: 'Designer', identity: { portfolio: 'https://jobyougo.xyz/portfolio' } };
  const chatFn = fakeModel();
  const out = await resolveUnknownFields({ fields: [{ i: 0, label: 'Why do you want to join Oradian?', kind: 'long text', required: true }], spec, career, portfolio, chatFn });
  assert.match(out['0'], /Shiseido/);
  assert.ok(!out['0'].startsWith('https://'), 'no link pushed into a non-portfolio answer');
  assert.ok(chatFn.prompts.some((p) => p.includes('Why do you want to join Oradian?')));
  assert.ok(!chatFn.prompts.some((p) => /walk through two or three projects/.test(p)));
});

test('before 6c6405fb kept: a profile fact in a long box (notice period) is still copied, no model', async () => {
  const spec = { company: 'Darkroom', role: 'Designer', identity: { portfolio: 'https://jobyougo.xyz/portfolio', noticePeriod: '1 month' } };
  const chatFn = fakeModel();
  const out = await resolveUnknownFields({ fields: [{ i: 0, label: 'What is your notice period?', kind: 'long text', required: true }], spec, career, portfolio, chatFn });
  assert.equal(out['0'], '1 month');
  assert.equal(chatFn.prompts.length, 0);
});
