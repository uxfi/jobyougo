import test from 'node:test';
import assert from 'node:assert/strict';
import { ApplyBridge, planToUpdate, serializePrefer } from '../extension/apply-bridge-lib.mjs';
import { AUTO_APPLY_TEXT_RE } from '../lib/apply-progression.mjs';
import { DECLINE_RE } from '../lib/apply-select.mjs';

test('serializePrefer keeps RegExp source/flags', () => {
  const s = serializePrefer(/outside|other/i);
  assert.equal(s.source, 'outside|other');
  assert.match(s.flags, /i/);
});

test('planToUpdate: selectPrefer-only plans still produce an update', () => {
  const f = {
    i: 3,
    frameId: 0,
    type: 'text',
    tag: 'input',
    label: 'State',
    role: 'combobox',
    ariaHaspopup: 'listbox',
    options: [],
  };
  const plan = { selectPrefer: /outside|not in (the )?u\.?s|international|other/i, leaveBlank: true };
  // leaveBlank is skip path in classify; here we only test planToUpdate with prefer.
  const preferOnly = { selectPrefer: plan.selectPrefer };
  const u = planToUpdate(f, preferOnly);
  assert.ok(u);
  assert.ok(u.selectPrefer?.source);
  assert.match(u.selectPrefer.source, /outside/);
  assert.equal(u.selectText, '');
});

test('planToUpdate: yes/no radio still sends Yes/No', () => {
  const f = { i: 1, type: 'radio', tag: 'input', label: 'Visa?', options: [{ text: 'Yes' }, { text: 'No' }] };
  const u = planToUpdate(f, { yesNo: 'no', selectText: 'No' });
  assert.equal(u.selectText, 'No');
  assert.equal(u.choice, true);
});

test('planToUpdate: a city list may be searched; relocation and prose lists are pick-only', () => {
  const city = planToUpdate(
    { i: 4, type: 'text', tag: 'input', label: 'City', role: 'combobox', ariaHaspopup: 'listbox' },
    { value: 'Paris' },
  );
  assert.equal(city.list, true);
  assert.equal(city.typeQuery, 'Paris');
  const reloc = planToUpdate(
    { i: 5, type: 'text', tag: 'input', label: 'Willing to relocation?', role: 'combobox', ariaHaspopup: 'listbox' },
    { value: 'Yes' },
  );
  assert.equal(reloc.typeQuery, '');
  // Bitpanda EU passport mentions "hiring location" — must stay pick-only
  const eu = planToUpdate(
    {
      i: 7,
      type: 'text',
      tag: 'input',
      label: 'Do you currently possess an EU passport or a valid work permit that authorises you to work in the specified hiring location?',
      role: 'combobox',
      ariaHaspopup: 'listbox',
    },
    { yesNo: 'yes', selectText: 'Yes', value: 'Yes' },
    { city: 'Paris', country: 'France' },
  );
  assert.equal(eu.typeQuery, '');
  assert.equal(eu.selectText, 'Yes');
  const refs = planToUpdate(
    { i: 6, type: 'text', tag: 'input', label: 'Are you able to provide professional references?', role: 'combobox' },
    { value: 'Available upon request' },
  );
  assert.equal(refs.typeQuery, '');
});

test('planToUpdate: Location Hamburg/remote list picks remote-only and does not type', () => {
  const opts = [
    { text: 'Yes' },
    { text: 'No' },
    { text: 'Yes, no problem I am open to travel frequently' },
    { text: 'Yes, I would also consider to move to Hamburg' },
    { text: "No, this doesn't work for me I only want to work remote" },
  ];
  const u = planToUpdate(
    {
      i: 8,
      type: 'text',
      tag: 'input',
      label: 'Location',
      role: 'combobox',
      ariaHaspopup: 'listbox',
      options: opts,
    },
    { value: 'Paris, France', selectText: 'Paris, France', selectMatch: 'Paris' },
    { city: 'Paris', location: 'Paris, France' },
  );
  assert.match(String(u.selectText || ''), /only want to work remote/i);
  assert.equal(u.typeQuery, '');
});

test('planToUpdate: Location Yes|No does not send the city', () => {
  const u = planToUpdate(
    {
      i: 8,
      type: 'text',
      tag: 'input',
      label: 'Location',
      role: 'combobox',
      ariaHaspopup: 'listbox',
      options: [{ text: 'Yes' }, { text: 'No' }],
    },
    { value: 'Paris, France', selectText: 'Paris, France', selectMatch: 'Paris' },
  );
  assert.equal(u.selectText, 'Yes');
  assert.equal(u.typeQuery, '');
});

test('planToUpdate: how did you hear sends a ranked source and the rank list', () => {
  const plan = {
    value: 'Found the role while researching companies matching my criteria.',
    selectText: 'LinkedIn',
    selectRank: [/\blinkedin\b/i, /\b(other|autre)\b/i],
    selectPrefer: /\blinkedin\b|\bother\b/i,
  };
  const u = planToUpdate(
    {
      i: 9,
      type: 'radio',
      tag: 'input',
      label: 'How did you hear about this job?',
      options: [{ text: 'Other' }, { text: 'LinkedIn' }],
    },
    plan,
  );
  assert.equal(u.selectText, 'LinkedIn');
  assert.equal(u.selectRank?.[0]?.source, '\\blinkedin\\b');
});

test('planToUpdate: current location searches the city and must pick a suggestion', () => {
  const u = planToUpdate(
    { i: 4, type: 'text', tag: 'input', label: 'Current location', name: 'location', idAttr: 'location-input' },
    { value: 'Bangkok, Thailand', selectText: 'Bangkok, Thailand', selectMatch: 'Bangkok' },
    { city: 'Bangkok', location: 'Bangkok, Thailand' },
  );
  assert.equal(u.placeSuggest, true);
  assert.equal(u.typeQuery, 'Bangkok');
  // "Where are you located?" is the same typeahead under a question.
  const located = planToUpdate(
    { i: 6, type: 'text', tag: 'input', label: 'Where are you located?', placeholder: 'Start typing...' },
    { value: 'Paris, France', selectText: 'Paris, France', selectMatch: 'Paris' },
    { city: 'Paris', location: 'Paris, France' },
  );
  assert.equal(located.placeSuggest, true);
  assert.equal(located.typeQuery, 'Paris');
  const phone = planToUpdate(
    { i: 5, type: 'tel', tag: 'input', label: 'Phone', name: 'phone' },
    { value: '6 95 65 91 31' },
  );
  assert.equal(phone.placeSuggest, undefined);
  assert.equal(phone.value, '6 95 65 91 31');
});

test('planToUpdate: residence country is a list, phone with code is not a location search', () => {
  const country = planToUpdate(
    {
      i: 1,
      type: 'select-one',
      tag: 'select',
      label: 'Country/Region of Residence:*',
      name: 'fbclc_country',
      options: [{ text: 'France' }, { text: 'Thailand' }],
    },
    { value: 'France', selectText: 'France', selectMatch: 'France' },
    { city: 'Paris', country: 'France', location: 'Paris, France' },
  );
  assert.equal(country.placeSuggest, undefined);
  assert.equal(country.selectText, 'France');
  const phone = planToUpdate(
    {
      i: 2,
      type: 'text',
      tag: 'input',
      label: 'Primary Contact Number (including the country code)',
      name: 'tor__fcellPhone',
    },
    { value: '+33 6 95 65 91 31' },
  );
  assert.equal(phone.placeSuggest, undefined);
  assert.equal(phone.value, '+33 6 95 65 91 31');
});

test('planToUpdate: long text marks humanType', () => {
  const f = { i: 2, type: 'textarea', tag: 'textarea', label: 'Why us?' };
  const long = 'A'.repeat(60);
  const u = planToUpdate(f, { value: long });
  assert.equal(u.humanType, true);
  assert.equal(u.value.length, 60);
});

test('DECLINE_RE serializes for extension decline-without-options', () => {
  const s = serializePrefer(DECLINE_RE);
  assert.ok(s.source.length > 10);
  assert.ok(new RegExp(s.source, s.flags).test('Prefer not to say'));
});

// ── Run loops with the extension stubbed ───────────────────────────────────
// No socket: every request a case does not answer fails at once, and the
// page helpers answer from `helpers` by name.
function stubBridge(helpers = {}, overrides = {}) {
  const bridge = new ApplyBridge();
  bridge.capabilities = new Set(['page-helper', 'submit-pick']);
  Object.assign(bridge, {
    _request: async (type) => { throw new Error(`stub: ${type}`); },
    _pageHelper: async (_tabId, name) => (name in helpers ? helpers[name] : null),
    getTab: async () => ({ url: 'https://jobs.example/offer/1' }),
    ...overrides,
  });
  return bridge;
}

function stubRun(bridge, spec = {}) {
  const states = [];
  const run = bridge._newRun(7, { jobUrl: 'https://jobs.example/offer/1', identity: {}, ...spec }, {
    onState: async (s) => { states.push(s); },
    pollCommand: async () => null,
  });
  return { run, states };
}

test('navigation clicks a board\'s auto-apply only when the run may send on its own', async () => {
  for (const autoSubmit of [false, true]) {
    const tried = [];
    const bridge = stubBridge({ LIST_VISIBLE_NAV_BUTTONS: autoSubmit ? [] : [{ n: 0, text: 'AUTO APPLY' }] }, {
      _readTab: async () => ({ fields: [], probe: { verdict: 'none' } }),
      clickProgression: async (_tabId, re) => { tried.push(re); return { clicked: false }; },
    });
    const { run } = stubRun(bridge, { autoSubmit });
    assert.equal(await bridge._navigateToForm(run, { maxHops: 1 }), 'human');
    assert.equal(tried.includes(AUTO_APPLY_TEXT_RE), autoSubmit, `autoSubmit=${autoSubmit}`);
    // Without auto-send the model is never even asked about it.
    if (!autoSubmit) assert.deepEqual(run.navAi, { nav: 0, review: 0 });
  }
});

test('an Apply entry beside the form\'s own Submit does not hold the form back (Greenhouse)', async () => {
  const fields = [{ i: 0, frameId: 0, type: 'email', tag: 'input', label: 'Email', value: 'a@b.co' }];
  const bridge = stubBridge({
    SUBMIT_CANDIDATES: [{ frameId: 0, candidates: [{ n: 0, text: 'Submit application', inFieldForm: true }] }],
    PAGE_SHOWS_APPLY_ENTRY: true,
    PAGE_STEP_SNAPSHOT: { heading: 'Senior Designer', bodySnippet: '' },
    ACTION_LABELS: ['Apply for this job', 'Submit application'],
  }, {
    detectFieldsInTab: async () => ({ fields }),
    _fillOnce: async () => ({ filled: [{ label: 'Email', value: 'a@b.co' }], pending: [], uploaded: [] }),
    clickProgression: async () => assert.fail('the Apply entry is not clicked over an open form'),
  });
  const { run, states } = stubRun(bridge, { autoSubmit: false });
  assert.deepEqual(await bridge._fillPass(run), { submitted: false });
  assert.match(states.at(-1).message, /^Form ready/);
});

test('a file slot with no file to give is not re-attempted on every pass', async () => {
  const fields = [
    { i: 0, frameId: 0, type: 'email', tag: 'input', label: 'Email', value: 'a@b.co' },
    { i: 1, frameId: 0, type: 'file', tag: 'input', label: 'Cover letter', required: true, fileCount: 0 },
    { i: 2, frameId: 0, type: 'text', tag: 'input', label: 'Pronouns', value: '' },
  ];
  let fills = 0;
  const bridge = stubBridge({}, {
    detectFieldsInTab: async () => ({ fields }),
    _fillOnce: async () => {
      fills += 1;
      return {
        filled: [{ label: 'Email', value: 'a@b.co' }],
        pending: [{ label: 'Cover letter', reason: 'lettre de motivation — aucune générée pour cette offre (menu ⋯ → Cover letter), puis Rescan' }],
        uploaded: [],
      };
    },
  });
  const { run, states } = stubRun(bridge, { autoSubmit: false, answers: [] });
  await bridge._fillPass(run);
  assert.equal(fills, 1);
  assert.ok(!run.steps.some((s) => /Relance auto/.test(s.text)));
  // The empty box in neither list is in the state and the log, for audits.
  assert.deepEqual(states.at(-1).skipped.map((x) => x.label), ['Pronouns']);
  assert.ok(run.steps.some((s) => s.text === '1 champ(s) ignoré(s) : Pronouns'));
});
