import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { COLLECT_FIELDS } from '../lib/apply-collect-fields.mjs';
import { pickAttestedTools, attestedTools } from '../lib/apply-tool-match.mjs';
import { classifyField } from '../lib/apply-classify.mjs';
import { pickSelectOption } from '../lib/apply-select.mjs';
import { readFileSync } from 'node:fs';

const HUGO_TOOLS = [
  'Figma is my main tool (also Sketch, Adobe XD, Principle and Zeplin). Today I prototype directly in code with Cursor and Claude Code.',
  'Vercel v0 for live prototypes, Claude API, ChatGPT / GPT-4o and OpenRouter, Midjourney, Flux, Runway, Kling and Veo 3.',
  'Next.js (React) with Tailwind CSS and shadcn/ui; JavaScript self-rated 6/10; my Jarvos project has a TypeScript orchestrator.',
].join('\n');

test('tool checklists tick only attested tools, with aliases', () => {
  const opts = ['Figma', 'Sketch', 'Framer', 'Cursor', 'Claude', 'GitHub Copilot', 'React.js', 'Vue', 'TypeScript', 'Tailwind', 'shadcn/ui', 'v0 by Vercel', 'Midjourney', 'Lovable', 'None of the above'];
  const r = pickAttestedTools(opts, HUGO_TOOLS);
  const picked = r.picks.map((i) => opts[i]);
  assert.deepEqual(picked, ['Figma', 'Sketch', 'Cursor', 'Claude', 'React.js', 'TypeScript', 'Tailwind', 'shadcn/ui', 'v0 by Vercel', 'Midjourney']);
  assert.ok(attestedTools('Claude Code').has('claude'), 'Claude Code attests Claude');
  assert.ok(!attestedTools('Claude').has('claudecode'), 'Claude alone does not attest Claude Code');
  assert.ok(attestedTools('Next.js').has('react'));
});

test('a tool checklist with nothing attested returns no pick (left to the human), sentences are not tool lists', () => {
  const none = pickAttestedTools(['Jira', 'Asana', 'Linear', 'Trello'], HUGO_TOOLS);
  assert.ok(none === null || none.picks.length === 0);
  assert.equal(pickAttestedTools(['I design in Figma and ship production frontend code myself', 'I design in Figma and hand off to engineers'], HUGO_TOOLS), null);
});

test('Darkroom: English C1 picks "Professional-Level", never "Fluent / Native-Speaker"', () => {
  const spec = { identity: { languages: [{ name: 'English', level: 'Fluent', cefr: 'C1' }] }, answers: [] };
  const f = { type: 'text', tag: 'input', label: 'Please describe your English proficiency skills:', options: ['Beginner', 'Intermediate', 'Professional-Level ', 'Fluent / Native-Speaker'].map((t) => ({ text: t, value: t })), required: true };
  const plan = classifyField(f, spec);
  assert.ok(plan, 'english plan');
  const pick = pickSelectOption(f.options, plan, f.label);
  assert.match(String(pick?.text || pick || ''), /Professional-Level/);
});

test('Screenloop: a currency picker read as "Pound Sterling (£)" takes the profile currency (EUR)', () => {
  const plan = classifyField({ type: 'text', tag: 'input', role: 'combobox', label: 'Pound Sterling (£)' }, { identity: { salaryCurrency: 'EUR' }, answers: [] });
  assert.ok(plan?.selectPrefer?.test('Euro (€)'));
  assert.ok(!plan.selectPrefer.test('Pound Sterling (£)'));
});

test('jobs.workable.com: optional cookies are declined first, accepted only without a refusal button', () => {
  const bg = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
  const body = bg.slice(bg.indexOf('async function dismissCookiesInTab'), bg.indexOf('async function fillFieldsInPage'));
  assert.ok(body.indexOf('for (const re of [decline, accept])') > 0);
  assert.match(body, /decline\( all\)\?/);
});

const browser = await chromium.launch({ headless: true }).catch(() => null);
test('Screenloop DOM: sibling asterisk = required; "Choose file" + Browse = CV file slot', { skip: !browser }, async () => {
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><html><body><form>
    <div><div><label>What is your expected gross salary?</label><span>*</span></div>
      <div><input type="text" inputmode="numeric" name="salaryExpectation"></div></div>
    <div><div><label>If yes, briefly describe the product domain and your ownership:</label><span>*</span></div>
      <textarea name="customQuestionAnswers.34397"></textarea></div>
    <div><div><label>Optional note</label></div><textarea name="note"></textarea></div>
    <div><div><label>CV</label><span>*</span></div><div><div><input type="hidden" name="atsApplicationFormResume.content">
      <span><input type="text" readonly placeholder="Choose file" name="atsApplicationFormResume.filename"></span>
      <button type="button">Browse</button></div></div></div>
  </form></body></html>`);
  const fields = await page.evaluate(COLLECT_FIELDS);
  const by = (re) => fields.find((f) => re.test(f.label || '') || re.test(f.name || ''));
  assert.equal(by(/expected gross salary/)?.required, true, JSON.stringify(fields.map((f) => [f.label, f.required, f.type])));
  assert.equal(by(/product domain/)?.required, true);
  assert.equal(by(/Optional note/)?.required, false);
  const cv = fields.find((f) => f.type === 'file');
  assert.ok(cv, 'CV slot detected as a file field');
  assert.equal(cv.required, true);
  await page.close();
});
test.after(async () => { await browser?.close(); });