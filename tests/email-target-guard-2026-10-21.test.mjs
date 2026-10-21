import test from 'node:test';
import assert from 'node:assert/strict';
import { safeCompanyHint, stripUnsourcedCompanyBlurb } from '../lib/email-target-guard.mjs';

const CV = `# Hugo Vermot\n\n## Experience\n\n### Head of Product : OneAsset (Feb 2026 - present)\n- Shipped the investor app.\n`;
const VERTECH = `Hello,\n\nVertech Industrial Systems develops industrial automation solutions for manufacturing environments. I'm applying for the UX/UI Designer role.\n\nSince 2022, I've built and shipped AI-powered SaaS products. It is the kind of problem I want to solve.\n\nBest,\nHugo Vermot\nhttps://jobyougo.xyz/portfolio\nhttps://linkedin.com/in/hugovermot`;

test('company hint: own company dropped, other kept', () => {
  assert.equal(safeCompanyHint('OneAsset', CV), '');
  assert.equal(safeCompanyHint('Vertech Industrial Systems', CV), 'Vertech Industrial Systems');
});

test('no source read: invented company description cut, even when the company is unknown', () => {
  for (const company of ['Vertech Industrial Systems', '']) {
    const out = stripUnsourcedCompanyBlurb(VERTECH, { company, sourceText: '' });
    assert.equal(out.removed.length, 1);
    assert.doesNotMatch(out.body, /develops industrial automation/);
    assert.match(out.body, /^Hello,\n\nI'm applying for the UX\/UI Designer role\./);
    assert.match(out.body, /It is the kind of problem/);
    assert.match(out.body, /https:\/\/jobyougo\.xyz\/portfolio/);
    assert.doesNotMatch(out.body, /\[(Nom|Name|Company|Entreprise)[^\]]*\]/i);
    assert.doesNotMatch(out.body, /OneAsset/);
  }
});

test('posting or site read: body untouched', () => {
  const out = stripUnsourcedCompanyBlurb(VERTECH, { company: 'Vertech Industrial Systems', sourceText: 'We build automation software.' });
  assert.equal(out.body, VERTECH);
  assert.equal(out.removed.length, 0);
});

test('draft length stays within the budget after the cut', () => {
  const words = stripUnsourcedCompanyBlurb(VERTECH, {}).body.split(/\s+/).filter(Boolean).length;
  assert.ok(words < 180, String(words));
});