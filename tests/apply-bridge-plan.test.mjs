import test from 'node:test';
import assert from 'node:assert/strict';
import { planToUpdate, serializePrefer } from '../extension/apply-bridge-lib.mjs';
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
