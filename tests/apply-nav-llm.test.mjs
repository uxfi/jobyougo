import test from 'node:test';
import assert from 'node:assert/strict';
import {
  askNavDecision,
  filterNavButtons,
  newNavAiBudget,
  parseNavDecision,
  resolveNavAction,
  navDecisionLog,
} from '../lib/apply-nav-llm.mjs';

test('filterNavButtons drops auth, back, and already tried labels', () => {
  const out = filterNavButtons([
    { text: 'Continue with Google' },
    { text: 'Sign in' },
    { text: 'Back' },
    { text: 'Next' },
    { text: 'Apply without account' },
  ], ['Next']);
  assert.deepEqual(out.map((b) => b.text), ['Apply without account']);
});

test('filterNavButtons drops documents and legal pages, never a posting that mentions them', () => {
  const out = filterNavButtons([
    { n: 0, text: 'Apply Manually', href: '' },
    { n: 4, text: 'here', href: 'https://www.lseg.com/content/dam/lseg/en_us/documents/policies/lseg-global-candidate-privacy-notice.pdf' },
    { n: 5, text: 'here', href: 'https://acme.test/files/candidate-notice.docx?v=2' },
    { n: 6, text: 'Privacy Policy', href: 'https://acme.test/privacy-policy' },
    { n: 7, text: 'Terms', href: 'https://acme.test/legal/terms' },
    { n: 8, text: 'ici', href: 'https://acme.fr/politique-de-confidentialite' },
    { n: 9, text: 'Continue', href: 'https://acme.wd3.myworkdayjobs.com/en-US/Careers/job/London/Senior-Legal-Counsel_R123/apply' },
    { n: 10, text: 'View role', href: 'https://acme.test/jobs/123-privacy-engineer' },
  ], [], { phase: 'navigate' });
  assert.deepEqual(out.map((b) => b.n), [0, 9, 10]);
});

test('parseNavDecision maps a click index to the button text', () => {
  const d = parseNavDecision(
    '{"action":"click","index":1,"reason":"opens the form"}',
    [{ text: 'Save draft' }, { text: 'Start application' }],
  );
  assert.equal(d.action, 'click');
  assert.equal(d.index, 1);
  assert.equal(d.text, 'Start application');
});

test('parseNavDecision refuses auth and back even if they are listed', () => {
  assert.equal(parseNavDecision('{"action":"click","index":0}', [{ text: 'Sign in' }]).action, 'human');
  assert.equal(parseNavDecision('{"action":"click","index":0}', [{ text: 'Edit' }]).action, 'human');
  assert.equal(parseNavDecision('{"action":"click","index":4}', [{ text: 'Next' }]).action, 'human');
  assert.equal(parseNavDecision('not json', []).action, 'human');
});

test('parseNavDecision accepts review and fill without an index', () => {
  assert.equal(parseNavDecision('{"action":"review","reason":"summary"}', []).action, 'review');
  assert.equal(parseNavDecision('{"action":"fill"}', []).action, 'fill');
});

test('resolveNavAction renumbers after dropping auth and does not call the model with no buttons', async () => {
  const decision = await resolveNavAction({
    phase: 'navigate',
    buttons: [{ text: 'Sign in' }, { text: 'Apply without account' }],
    chat: async () => '{"action":"click","index":0,"reason":"guest"}',
  });
  assert.equal(decision.action, 'click');
  assert.equal(decision.text, 'Apply without account');
  assert.match(navDecisionLog(decision), /Apply without account/);

  let called = false;
  const skipped = await resolveNavAction({
    phase: 'navigate',
    buttons: [{ text: 'Log in' }],
    chat: async () => { called = true; return '{}'; },
  });
  assert.equal(called, false);
  assert.equal(skipped.action, 'human');
  assert.equal(skipped.skipped, true);
  assert.equal(navDecisionLog(skipped), '');
});

test('resolveNavAction returns human when the model is down', async () => {
  const d = await resolveNavAction({
    phase: 'review',
    buttons: [],
    chat: async () => { throw new Error('offline'); },
  });
  assert.equal(d.action, 'human');
  assert.match(d.reason, /indisponible/);
});

test('askNavDecision spends one call per decision and stops at the run budget', async () => {
  const budget = newNavAiBudget();
  let calls = 0;
  const ask = () => askNavDecision(budget, {
    phase: 'navigate',
    listButtons: async () => [{ text: 'Apply now' }],
    chat: async () => { calls += 1; return '{"action":"click","index":0,"reason":"cta"}'; },
  });
  assert.equal((await ask()).text, 'Apply now');
  await ask();
  const capped = await ask();
  assert.equal(calls, 2);
  assert.equal(capped.skipped, true);
  assert.equal(capped.reason, 'plafond');
});

test('a board\'s auto-apply is never offered to the model unless the run may send on its own', async () => {
  const buttons = [{ text: 'AUTO APPLY' }, { text: 'AI Apply' }, { text: 'Apply manually' }];
  assert.deepEqual(filterNavButtons(buttons, [], { phase: 'navigate' }).map((b) => b.text), ['Apply manually']);
  assert.deepEqual(filterNavButtons(buttons, [], { phase: 'navigate', allowAutoApply: true }).map((b) => b.text), ['AUTO APPLY', 'AI Apply', 'Apply manually']);
  assert.equal(parseNavDecision('{"action":"click","index":0}', [{ text: 'AI Auto-Apply' }], { phase: 'navigate' }).action, 'human');
  assert.equal(parseNavDecision('{"action":"click","index":0}', [{ text: 'AI Auto-Apply' }], { phase: 'navigate', allowAutoApply: true }).action, 'click');

  const prompts = [];
  const chat = async ({ messages }) => { prompts.push(messages[0].content); return '{"action":"click","index":0}'; };
  const refused = await askNavDecision(newNavAiBudget(), { phase: 'navigate', listButtons: async () => [{ text: 'Auto apply' }], chat });
  assert.equal(refused.reason, 'aucun bouton');
  assert.equal(prompts.length, 0, 'the model is not asked to pick among nothing but auto-apply');
  const allowed = await askNavDecision(newNavAiBudget(), { phase: 'navigate', allowAutoApply: true, listButtons: async () => [{ text: 'Auto apply' }], chat });
  assert.equal(allowed.text, 'Auto apply');
  await resolveNavAction({ phase: 'navigate', buttons: [{ text: 'Apply' }], chat });
  assert.match(prompts.at(-1), /Never choose a job board's Auto Apply/);
});

test('askNavDecision never lists buttons or spends budget once capped, and skips pages without buttons', async () => {
  const budget = { nav: 0, review: 3 };
  let listed = false;
  const capped = await askNavDecision(budget, { phase: 'review', listButtons: async () => { listed = true; return []; } });
  assert.equal(capped.skipped, true);
  assert.equal(listed, false);

  const empty = await askNavDecision(budget, { phase: 'navigate', listButtons: async () => [{ text: 'Log in' }] });
  assert.equal(empty.reason, 'aucun bouton');
  assert.equal(budget.nav, 0);
});

test('filterNavButtons drops a search-results pager labelled Next', () => {
  const out = filterNavButtons([
    { text: 'Next', href: 'https://www.naukri.com/senior-ux-designer-jobs-in-remote-2' },
    { text: 'Apply', href: 'https://www.naukri.com/job-listings-senior-ux-designer-acme-170826029671' },
  ], [], { phase: 'navigate' });
  assert.deepEqual(out.map((b) => b.text), ['Apply']);
  assert.equal(parseNavDecision(
    '{"action":"click","index":0,"reason":"next page"}',
    [{ text: 'Next', href: 'https://www.naukri.com/senior-ux-designer-jobs-in-remote-3' }],
    { phase: 'navigate' },
  ).reason, 'pagination de recherche');
});
