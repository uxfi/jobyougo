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
